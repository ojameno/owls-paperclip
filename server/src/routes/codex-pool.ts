import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createCodexPoolService } from "../services/codex-pool.js";
import { logActivity } from "../services/activity-log.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function codexPoolRoutes(db: Db) {
  const router = Router();
  const poolService = createCodexPoolService(db);

  router.get("/companies/:companyId/codex-pool", async (req, res) => {
    const { companyId } = req.params;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    try {
      const accounts = await poolService.listAccounts(companyId);
      res.json({ accounts });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/companies/:companyId/codex-pool", async (req, res) => {
    const { companyId } = req.params;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    const { label, authJson, priority } = req.body as {
      label?: string;
      authJson?: string;
      priority?: number;
    };

    if (!label || typeof label !== "string") {
      return res.status(400).json({ error: "label is required" });
    }

    if (!authJson || typeof authJson !== "string") {
      return res.status(400).json({ error: "authJson is required" });
    }

    try {
      const account = await poolService.addAccount({ companyId, label, authJson, priority });

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "system",
        action: "codex_pool_account_added",
        entityType: "codex_account_pool",
        entityId: account.id,
        details: {
          accountId: account.id,
          label: account.label,
          email: account.email,
        },
      });

      res.json({ account });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/companies/:companyId/codex-pool/:accountId", async (req, res) => {
    const { companyId, accountId } = req.params;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    try {
      await poolService.deleteAccount(accountId, companyId);

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "system",
        action: "codex_pool_account_removed",
        entityType: "codex_account_pool",
        entityId: accountId,
        details: { accountId },
      });

      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/companies/:companyId/codex-pool/:accountId/check-quota", async (req, res) => {
    const { companyId, accountId } = req.params;
    assertBoard(req);
    assertCompanyAccess(req, companyId);

    try {
      const result = await poolService.checkAccountQuota(accountId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
