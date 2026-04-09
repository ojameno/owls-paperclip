import { api } from "./client";

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
  exhaustedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const codexPoolApi = {
  list: (companyId: string) =>
    api.get<{ accounts: CodexPoolAccount[] }>(`/companies/${companyId}/codex-pool`),
  add: (companyId: string, data: { label: string; authJson: string; priority?: number }) =>
    api.post<{ account: CodexPoolAccount }>(`/companies/${companyId}/codex-pool`, data),
  delete: (companyId: string, accountId: string) =>
    api.delete<{ success: true }>(`/companies/${companyId}/codex-pool/${accountId}`),
  checkQuota: (companyId: string, accountId: string) =>
    api.post<{ hasQuota: boolean; windows: Array<{ label: string; usedPercent: number | null; resetsAt: string | null }>; error?: string }>(
      `/companies/${companyId}/codex-pool/${accountId}/check-quota`,
      {}
    ),
};
