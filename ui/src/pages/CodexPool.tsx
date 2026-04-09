import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";
import { codexPoolApi, type CodexPoolAccount } from "@/api/codexPool";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";

export function CodexPool() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const { data: poolData, isLoading, error } = useQuery({
    queryKey: queryKeys.codexPool(selectedCompanyId!),
    queryFn: () => codexPoolApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const addMutation = useMutation({
    mutationFn: (data: { label: string; authJson: string }) =>
      codexPoolApi.add(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.codexPool(selectedCompanyId!) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (accountId: string) => codexPoolApi.delete(selectedCompanyId!, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.codexPool(selectedCompanyId!) });
    },
  });

  const checkQuotaMutation = useMutation({
    mutationFn: (accountId: string) => codexPoolApi.checkQuota(selectedCompanyId!, accountId),
  });

  const accounts = poolData?.accounts ?? [];

  if (!selectedCompanyId) {
    return <div className="p-6">Select a company to manage Codex accounts</div>;
  }

  if (isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  if (error) {
    return <div className="p-6 text-destructive">Failed to load Codex pool</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Codex Account Pool</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage Codex accounts for automatic quota rotation
          </p>
        </div>
        <AddAccountDialog onAdd={(data) => addMutation.mutate(data)} />
      </div>

      {accounts.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center">
          <p className="text-muted-foreground mb-4">No Codex accounts in the pool</p>
          <p className="text-sm text-muted-foreground mb-6">
            Add accounts to enable automatic quota rotation for Codex agents
          </p>
          <AddAccountDialog onAdd={(data) => addMutation.mutate(data)} />
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onDelete={() => deleteMutation.mutate(account.id)}
              onCheckQuota={() => checkQuotaMutation.mutate(account.id)}
              quotaResult={checkQuotaMutation.data}
              checkingQuota={checkQuotaMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountCard({
  account,
  onDelete,
  onCheckQuota,
  quotaResult,
  checkingQuota,
}: {
  account: CodexPoolAccount;
  onDelete: () => void;
  onCheckQuota: () => void;
  quotaResult?: { hasQuota: boolean; error?: string };
  checkingQuota: boolean;
}) {
  const statusConfig = {
    active: { icon: CheckCircle, color: "text-green-500", label: "Active" },
    exhausted: { icon: XCircle, color: "text-red-500", label: "Exhausted" },
    error: { icon: XCircle, color: "text-red-500", label: "Error" },
  }[account.status];

  const StatusIcon = statusConfig.icon;

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold">{account.label}</h3>
            <Badge variant={account.status === "active" ? "default" : "destructive"}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusConfig.label}
            </Badge>
            {account.email && (
              <span className="text-sm text-muted-foreground">{account.email}</span>
            )}
          </div>
          {account.planType && (
            <p className="text-sm text-muted-foreground">Plan: {account.planType}</p>
          )}
          {account.exhaustedAt && (
            <p className="text-sm text-muted-foreground mt-1">
              Exhausted: {new Date(account.exhaustedAt).toLocaleString()}
            </p>
          )}
          {quotaResult && (
            <div className="mt-2 text-sm">
              {quotaResult.hasQuota ? (
                <span className="text-green-500">Has quota available</span>
              ) : (
                <span className="text-red-500">{quotaResult.error || "No quota available"}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCheckQuota}
            disabled={checkingQuota}
          >
            <RefreshCw className={`h-4 w-4 ${checkingQuota ? "animate-spin" : ""}`} />
            Check Quota
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddAccountDialog({ onAdd }: { onAdd: (data: { label: string; authJson: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [authJson, setAuthJson] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (label && authJson) {
      onAdd({ label, authJson });
      setLabel("");
      setAuthJson("");
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Codex Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="space-y-4 overflow-y-auto pr-1">
            <div>
              <Label htmlFor="label">Label</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., Primary Codex Account"
                required
              />
            </div>
            <div>
              <Label htmlFor="authJson">auth.json content</Label>
              <Textarea
                id="authJson"
                value={authJson}
                onChange={(e) => setAuthJson(e.target.value)}
                placeholder='{"accessToken": "...", "accountId": "...", ...}'
                rows={6}
                required
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Paste the contents of your ~/.codex/auth.json file
              </p>
            </div>
          </div>
          <DialogFooter className="mt-4 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Account</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
