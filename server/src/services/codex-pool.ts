import path from "node:path";
import fs from "node:fs/promises";
import { eq, and, desc, lt, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { codexAccountPool } from "@paperclipai/db";
import { readCodexAuthInfo, fetchCodexRpcQuota, type CodexAuthInfo } from "@paperclipai/adapter-codex-local/server";
import { logger } from "../middleware/logger.js";

const EXHAUSTED_COOLDOWN_DAYS = 7;

export type CodexPoolAccount = {
  id: string;
  companyId: string;
  label: string;
  email: string | null;
  planType: string | null;
  authJson: string;
  codexHomePath: string | null;
  status: "active" | "exhausted" | "error";
  priority: number;
  exhaustedAt: Date | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatePoolAccountInput = {
  companyId: string;
  label: string;
  authJson: string;
  priority?: number;
};

export function createCodexPoolService(db: Db) {
  function resolveCodexPoolHomeDir(companyId: string, accountId: string): string {
    const paperclipHome = process.env.PAPERCLIP_HOME ?? path.resolve(process.env.HOME ?? "", ".paperclip");
    const instanceId = process.env.PAPERCLIP_INSTANCE_ID ?? "default";
    return path.resolve(
      paperclipHome,
      "instances",
      instanceId,
      "companies",
      companyId,
      "codex-pool",
      accountId,
    );
  }

  async function ensureCodexHomeDir(codexHomePath: string, authJson: string): Promise<void> {
    await fs.mkdir(codexHomePath, { recursive: true });
    const authPath = path.join(codexHomePath, "auth.json");
    await fs.writeFile(authPath, authJson, "utf8");
  }

  async function validateAuthJson(authJson: string): Promise<CodexAuthInfo | null> {
    try {
      const parsed = JSON.parse(authJson);
      // Create a temp directory with auth.json file (readCodexAuthInfo expects CODEX_HOME/auth.json)
      const tempDir = path.join(process.env.TMPDIR ?? "/tmp", `codex-auth-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      const authPath = path.join(tempDir, "auth.json");
      await fs.writeFile(authPath, JSON.stringify(parsed), "utf8");
      const info = await readCodexAuthInfo(tempDir);
      // Cleanup
      await fs.unlink(authPath).catch(() => {});
      await fs.rmdir(tempDir).catch(() => {});
      return info;
    } catch {
      return null;
    }
  }

  async function addAccount(input: CreatePoolAccountInput): Promise<CodexPoolAccount> {
    const authInfo = await validateAuthJson(input.authJson);
    if (!authInfo) {
      throw new Error("Invalid auth.json: could not parse or extract Codex auth info");
    }

    const accountId = crypto.randomUUID();
    const codexHomePath = resolveCodexPoolHomeDir(input.companyId, accountId);

    await ensureCodexHomeDir(codexHomePath, input.authJson);

    const [account] = await db
      .insert(codexAccountPool)
      .values({
        id: accountId,
        companyId: input.companyId,
        label: input.label,
        email: authInfo.email,
        planType: authInfo.planType,
        authJson: input.authJson,
        codexHomePath,
        status: "active",
        priority: input.priority ?? 0,
        updatedAt: new Date(),
      })
      .returning();

    logger.info(
      { accountId, companyId: input.companyId, email: authInfo.email },
      "Added Codex account to pool",
    );

    return account as CodexPoolAccount;
  }

  async function listAccounts(companyId: string): Promise<CodexPoolAccount[]> {
    const accounts = await db
      .select()
      .from(codexAccountPool)
      .where(eq(codexAccountPool.companyId, companyId))
      .orderBy(desc(codexAccountPool.priority), codexAccountPool.createdAt);

    return accounts as CodexPoolAccount[];
  }

  async function deleteAccount(accountId: string, companyId: string): Promise<void> {
    const account = await db
      .select({ codexHomePath: codexAccountPool.codexHomePath })
      .from(codexAccountPool)
      .where(and(eq(codexAccountPool.id, accountId), eq(codexAccountPool.companyId, companyId)))
      .then((rows) => rows[0]);

    if (!account) {
      throw new Error("Account not found");
    }

    await db
      .delete(codexAccountPool)
      .where(and(eq(codexAccountPool.id, accountId), eq(codexAccountPool.companyId, companyId)));

    if (account.codexHomePath) {
      try {
        await fs.rm(account.codexHomePath, { recursive: true, force: true });
      } catch (err) {
        logger.warn({ accountId, codexHomePath: account.codexHomePath, error: err }, "Failed to cleanup Codex home directory");
      }
    }

    logger.info({ accountId, companyId }, "Deleted Codex account from pool");
  }

  async function getActiveAccount(companyId: string): Promise<CodexPoolAccount | null> {
    const [account] = await db
      .select()
      .from(codexAccountPool)
      .where(
        and(
          eq(codexAccountPool.companyId, companyId),
          eq(codexAccountPool.status, "active"),
        ),
      )
      .orderBy(desc(codexAccountPool.priority), codexAccountPool.createdAt)
      .limit(1);

    return (account as CodexPoolAccount) ?? null;
  }

  async function markAccountExhausted(accountId: string, companyId: string): Promise<void> {
    await db
      .update(codexAccountPool)
      .set({
        status: "exhausted",
        exhaustedAt: new Date(),
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(codexAccountPool.id, accountId), eq(codexAccountPool.companyId, companyId)));

    logger.info({ accountId, companyId }, "Marked Codex account as exhausted");
  }

  async function renewExhaustedAccounts(): Promise<void> {
    const cooldownThreshold = new Date();
    cooldownThreshold.setDate(cooldownThreshold.getDate() - EXHAUSTED_COOLDOWN_DAYS);

    const exhaustedAccounts = await db
      .select()
      .from(codexAccountPool)
      .where(
        and(
          eq(codexAccountPool.status, "exhausted"),
          lt(codexAccountPool.exhaustedAt, cooldownThreshold),
        ),
      );

    if (exhaustedAccounts.length === 0) {
      return;
    }

    logger.info(
      { count: exhaustedAccounts.length },
      "Renewing exhausted Codex accounts after cooldown period",
    );

    for (const account of exhaustedAccounts) {
      await db
        .update(codexAccountPool)
        .set({
          status: "active",
          exhaustedAt: null,
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(codexAccountPool.id, account.id));

      logger.info({ accountId: account.id, companyId: account.companyId }, "Renewed exhausted Codex account");
    }
  }

  async function checkAccountQuota(accountId: string): Promise<{ hasQuota: boolean; error?: string }> {
    const account = await db
      .select({ codexHomePath: codexAccountPool.codexHomePath, authJson: codexAccountPool.authJson })
      .from(codexAccountPool)
      .where(eq(codexAccountPool.id, accountId))
      .then((rows) => rows[0]);

    if (!account || !account.codexHomePath) {
      return { hasQuota: false, error: "Account not found or no CODEX_HOME" };
    }

    try {
      const authInfo = await readCodexAuthInfo(account.codexHomePath);
      if (!authInfo) {
        return { hasQuota: false, error: "Could not read auth info" };
      }

      // Temporarily set CODEX_HOME to check quota for this specific account
      const originalCodexHome = process.env.CODEX_HOME;
      process.env.CODEX_HOME = account.codexHomePath;

      let quota;
      try {
        quota = await fetchCodexRpcQuota();
      } finally {
        // Restore original CODEX_HOME
        if (originalCodexHome !== undefined) {
          process.env.CODEX_HOME = originalCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
      }

      // Check if any window has available quota (usedPercent < 100 or null means unknown/available)
      const hasAnyQuota = quota.windows.some((w) => w.usedPercent === null || w.usedPercent < 100);
      if (!hasAnyQuota) {
        return { hasQuota: false, error: "All quota windows exhausted" };
      }

      return { hasQuota: true };
    } catch (err) {
      logger.warn({ accountId, error: err }, "Failed to check Codex account quota");
      return { hasQuota: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    addAccount,
    listAccounts,
    deleteAccount,
    getActiveAccount,
    markAccountExhausted,
    renewExhaustedAccounts,
    checkAccountQuota,
  };
}

export type CodexPoolService = ReturnType<typeof createCodexPoolService>;
