import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { eq, and, desc, lt, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { codexAccountPool } from "@paperclipai/db";
import { readCodexAuthInfo, type CodexAuthInfo } from "@paperclipai/adapter-codex-local/server";
import { logger } from "../middleware/logger.js";

const EXHAUSTED_COOLDOWN_DAYS = 7;

export type QuotaWindowInfo = {
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
};

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

  async function checkAccountQuota(accountId: string): Promise<{ hasQuota: boolean; windows: QuotaWindowInfo[]; error?: string }> {
    const account = await db
      .select({ codexHomePath: codexAccountPool.codexHomePath, authJson: codexAccountPool.authJson })
      .from(codexAccountPool)
      .where(eq(codexAccountPool.id, accountId))
      .then((rows) => rows[0]);

    if (!account || !account.codexHomePath) {
      return { hasQuota: false, windows: [], error: "Account not found or no CODEX_HOME" };
    }

    try {
      const authInfo = await readCodexAuthInfo(account.codexHomePath);
      if (!authInfo) {
        return { hasQuota: false, windows: [], error: "Could not read auth info" };
      }

      // Use HTTP WHAM API with isolated auth (thread-safe)
      const quota = await fetchCodexQuotaWithAuth(account.codexHomePath);

      // Check if any window has available quota (usedPercent < 100 or null means unknown/available)
      const hasAnyQuota = quota.windows.some((w) => w.usedPercent === null || w.usedPercent < 100);
      if (!hasAnyQuota) {
        return { hasQuota: false, windows: quota.windows, error: "All quota windows exhausted" };
      }

      return { hasQuota: true, windows: quota.windows };
    } catch (err) {
      logger.warn({ accountId, error: err }, "Failed to check Codex account quota");
      return { hasQuota: false, windows: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Fetch Codex quota via HTTP WHAM API (same as adapter does).
   * Thread-safe: uses isolated auth info, no global env changes.
   */
  async function fetchCodexQuotaWithAuth(codexHomePath: string): Promise<{ windows: QuotaWindowInfo[] }> {
    const auth = await readCodexAuthInfo(codexHomePath);
    if (!auth) throw new Error("Could not read auth info from CODEX_HOME");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.accessToken}`,
    };
    if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers,
        signal: controller.signal,
      });

      if (!resp.ok) throw new Error(`wham api returned ${resp.status}`);

      const body = (await resp.json()) as {
        rate_limit?: {
          primary_window?: { used_percent?: number; limit_window_seconds?: number; reset_at?: string | number };
          secondary_window?: { used_percent?: number; limit_window_seconds?: number; reset_at?: string | number };
        };
      };

      const windows: QuotaWindowInfo[] = [];
      const rateLimit = body.rate_limit;

      // Helper to format window label based on seconds
      function formatWindowLabel(seconds: number | null | undefined): string {
        if (seconds == null) return "limit";
        const hours = seconds / 3600;
        if (hours < 6) return "5h limit";
        if (hours <= 24) return "24h limit";
        if (hours <= 168) return "7d limit";
        return `${Math.round(hours / 24)}d limit`;
      }

      // Only add windows that have valid used_percent data
      const primary = rateLimit?.primary_window;
      if (primary?.used_percent != null) {
        windows.push({
          label: formatWindowLabel(primary.limit_window_seconds),
          usedPercent: Math.min(100, Math.round(primary.used_percent < 1 ? primary.used_percent * 100 : primary.used_percent)),
          resetsAt: typeof primary.reset_at === "number"
            ? new Date(primary.reset_at * 1000).toISOString()
            : (primary.reset_at ?? null),
        });
      }
      const secondary = rateLimit?.secondary_window;
      if (secondary?.used_percent != null) {
        windows.push({
          label: formatWindowLabel(secondary.limit_window_seconds),
          usedPercent: Math.min(100, Math.round(secondary.used_percent < 1 ? secondary.used_percent * 100 : secondary.used_percent)),
          resetsAt: typeof secondary.reset_at === "number"
            ? new Date(secondary.reset_at * 1000).toISOString()
            : (secondary.reset_at ?? null),
        });
      }

      return { windows };
    } finally {
      clearTimeout(timer);
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
