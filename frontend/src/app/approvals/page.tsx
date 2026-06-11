import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getApprovals } from "@/lib/api";
import { ApprovalsClient } from "../components/approvals-client";
import { LiveRefresh } from "../components/live-refresh";
import { BackendErrorState, PageButton, PageHeader } from "../components/ops-ui";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const result = await getApprovals()
    .then((value) => ({ value, error: null as Error | null }))
    .catch((error: unknown) => ({
      value: null,
      error: error instanceof Error ? error : new Error("The approval queue could not be loaded."),
    }));

  if (result.error || !result.value) {
    return (
      <BackendErrorState
        title="Approval queue unavailable"
        message={result.error?.message || "The approval queue could not be loaded."}
      />
    );
  }

  const approvals = result.value;

  return (
    <div>
      <LiveRefresh />
      <PageHeader
        eyebrow={`${approvals.length} pending approval(s)`}
        title="Approval queue"
        description="Medium and high-risk actions stop here until an operator approves or rejects them. Low-risk changes can auto-execute when policy allows it."
        actions={
          <>
            <PageButton href="/connectors" inverse>
              <ArrowLeft size={13} />
              Back to connectors
            </PageButton>
            <PageButton href="/settings">
              <ShieldCheck size={13} />
              Review policies
            </PageButton>
          </>
        }
      />
      <div>
        <ApprovalsClient initialApprovals={approvals} />
      </div>
    </div>
  );
}