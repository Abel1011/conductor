import Link from "next/link";
import { ClipboardCheck, ShieldCheck } from "lucide-react";
import { getPortfolio } from "@/lib/api";
import {
  BackendErrorState,
  BudgetBar,
  EmptyState,
  LINE,
  LINE_SOFT,
  MUTED,
  Panel,
  PageButton,
  PageHeader,
  StatusBadge,
  formatRelative,
  monoStyle,
} from "../components/ops-ui";

export const dynamic = "force-dynamic";

const ATTENTION_WEIGHT: Record<string, number> = {
  FAILURE: 5,
  OVER_BUDGET: 4,
  DELAYED: 3,
  HAS_COLD_TABLES: 2,
  PAUSED: 1,
  PENDING_SETUP: 1,
  HEALTHY: 0,
};

export default async function ConnectorsPage() {
  const result = await getPortfolio()
    .then((value) => ({ value, error: null as Error | null }))
    .catch((error: unknown) => ({
      value: null,
      error: error instanceof Error ? error : new Error("The connector portfolio could not be loaded."),
    }));

  if (result.error || !result.value) {
    return (
      <BackendErrorState
        title="Connector portfolio unavailable"
        message={result.error?.message || "The connector portfolio could not be loaded."}
      />
    );
  }

  const portfolio = result.value;
  const connections = [...portfolio.connections].sort(
    (left, right) =>
      (ATTENTION_WEIGHT[right.healthStatus] ?? 0) - (ATTENTION_WEIGHT[left.healthStatus] ?? 0) ||
      right.budgetPct - left.budgetPct
  );

  const headerCellClass = "px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em]";

  return (
    <div>
      <PageHeader
        eyebrow={`${portfolio.connections.length} connector(s) discovered`}
        title="Connector portfolio"
        description="The full connector estate ranked by urgency: failures and over-budget connectors first, healthy ones last. Click any row for table-level detail."
        actions={
          <>
            <PageButton href="/approvals" inverse>
              <ClipboardCheck size={13} />
              Review approvals
            </PageButton>
            <PageButton href="/settings">
              <ShieldCheck size={13} />
              Policies
            </PageButton>
          </>
        }
      />

      <div>
        {connections.length === 0 ? (
          <EmptyState
            title="No connectors yet"
            description="The backend is connected to Fivetran, but the account is still empty. Create the source connectors and the Platform Connector before expecting governance signals here."
            href="/onboarding"
            actionLabel="Open onboarding"
          />
        ) : (
          <Panel title="Connector inventory" eyebrow="Ranked by urgency and budget pressure">
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: LINE_SOFT, background: "#F8FAF8" }}>
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr className="border-b" style={{ borderColor: LINE }}>
                  <th className={headerCellClass} style={{ ...monoStyle, color: MUTED }}>Connector</th>
                  <th className={headerCellClass} style={{ ...monoStyle, color: MUTED }}>Status</th>
                  <th className={`${headerCellClass} min-w-[180px]`} style={{ ...monoStyle, color: MUTED }}>MAR / budget</th>
                  <th className={headerCellClass} style={{ ...monoStyle, color: MUTED }}>Owner</th>
                  <th className={headerCellClass} style={{ ...monoStyle, color: MUTED }}>SLA</th>
                  <th className={headerCellClass} style={{ ...monoStyle, color: MUTED }}>Cadence</th>
                  <th className={headerCellClass} style={{ ...monoStyle, color: MUTED }}>Last sync</th>
                  <th className={headerCellClass} style={{ ...monoStyle, color: MUTED }}>Cold</th>
                  <th className={headerCellClass} style={{ ...monoStyle, color: MUTED }}>Fail 7d</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => (
                  <tr
                    key={connection.id}
                    className="border-b transition last:border-b-0 hover:bg-black/3"
                    style={{ borderColor: LINE_SOFT }}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/connectors/${connection.id}`} className="block">
                        <span className="text-[13px] font-semibold" style={{ color: "#10181A" }}>
                          {connection.name}
                        </span>
                        <span className="mt-0.5 block text-[10px] uppercase tracking-[0.14em]" style={{ ...monoStyle, color: MUTED }}>
                          {connection.connectorType}
                        </span>
                        <span className="mt-0.5 block text-[10px] tracking-[0.04em]" style={{ ...monoStyle, color: MUTED }}>
                          ID: {connection.id}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={connection.healthStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <BudgetBar
                        current={connection.monthlyMarCurrent}
                        budget={connection.monthlyMarBudget}
                        pct={connection.budgetPct}
                      />
                    </td>
                    <td className="px-4 py-3 text-[12px]" style={{ ...monoStyle, color: MUTED }}>
                      {connection.teamOwner}
                    </td>
                    <td className="px-4 py-3 text-[11px] font-semibold uppercase" style={{ ...monoStyle, color: connection.slaTier === "CRITICAL" ? "#C03A2B" : MUTED }}>
                      {connection.slaTier}
                    </td>
                    <td className="px-4 py-3 text-[12px]" style={monoStyle}>
                      {connection.syncFrequencyMin}m
                    </td>
                    <td className="px-4 py-3 text-[12px]" style={{ ...monoStyle, color: MUTED }}>
                      {formatRelative(connection.lastSuccessfulSyncAt)}
                    </td>
                    <td className="px-4 py-3 text-[12px]" style={{ ...monoStyle, color: connection.coldTables > 0 ? "#B07816" : MUTED }}>
                      {connection.coldTables}
                    </td>
                    <td className="px-4 py-3 text-[12px]" style={{ ...monoStyle, color: connection.failureCount7d > 0 ? "#C03A2B" : MUTED }}>
                      {connection.failureCount7d}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}