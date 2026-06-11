import { notFound } from "next/navigation";
import { ArrowLeft, Cable, History, ShieldCheck, TableProperties } from "lucide-react";
import { getConnectorDetail } from "@/lib/api";
import {
  BackendErrorState,
  EmptyState,
  MUTED,
  PageButton,
  PageHeader,
  Panel,
  SIGNAL,
  StatusBadge,
  formatCompact,
  formatDateTime,
  formatRelative,
  monoStyle,
} from "../../components/ops-ui";
import { LiveRefresh } from "../../components/live-refresh";
import { TriggerSyncButton } from "../../components/trigger-sync-button";

export const dynamic = "force-dynamic";

export default async function ConnectorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getConnectorDetail(id)
    .then((value) => ({ value, error: null as Error | null }))
    .catch((error: unknown) => ({
      value: null,
      error: error instanceof Error ? error : new Error("The connector detail route could not be loaded."),
    }));

  if (result.error && /not found/i.test(result.error.message)) {
    notFound();
  }

  if (result.error || !result.value) {
    return (
      <BackendErrorState
        title="Connector detail unavailable"
        message={result.error?.message || "The connector detail route could not be loaded."}
      />
    );
  }

  const connection = result.value;

  return (
    <div>
      <LiveRefresh />
      <PageHeader
        eyebrow={`${connection.connectorType} · ${connection.teamOwner} · ${connection.slaTier} SLA`}
        title={connection.name}
        description={`Synced automatically by Fivetran every ${connection.syncFrequencyMin} minutes. Last sync status: ${connection.lastSyncStatus}. Conductor governs this connector through policies and agent actions.`}
        actions={
          <>
            <TriggerSyncButton connectionId={connection.id} />
            <PageButton href="/connectors">
              <ArrowLeft size={13} />
              Back to connectors
            </PageButton>
            <PageButton href="/settings">
              <ShieldCheck size={13} />
              Policies
            </PageButton>
          </>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <Panel title="Operational status" icon={<Cable size={15} />} eyebrow={connection.id}>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={connection.healthStatus} />
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{ ...monoStyle, background: connection.policyConfigured ? "rgba(11,138,92,0.10)" : "rgba(16,24,26,0.05)", color: connection.policyConfigured ? SIGNAL : MUTED }}
              >
                {connection.policyConfigured ? "Policy active" : "No policy yet"}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { label: "Monthly MAR", value: formatCompact(connection.monthlyMarCurrent) },
                { label: "Budget", value: formatCompact(connection.monthlyMarBudget) },
                { label: "Auto-sync", value: `every ${connection.syncFrequencyMin}m` },
                { label: "Avg sync", value: `${connection.avgSyncDurationMin.toFixed(1)}m` },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border px-3 py-3" style={{ borderColor: "rgba(16,24,26,0.08)", background: "rgba(16,24,26,0.02)" }}>
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em]" style={{ ...monoStyle, color: MUTED }}>
                    {item.label}
                  </p>
                  <p className="mt-1.5 text-xl font-semibold tracking-tight" style={monoStyle}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 text-[12px]" style={{ ...monoStyle, color: MUTED }}>
              <p>Last successful sync: <span style={{ color: "#10181A" }}>{formatRelative(connection.lastSuccessfulSyncAt)}</span></p>
              <p>Consecutive failures: <span style={{ color: "#10181A" }}>{connection.consecutiveFailures}</span></p>
              <p>Projected savings if proposals execute: <span style={{ color: SIGNAL }}>{formatCompact(connection.projectedSavingsMar)} MAR</span></p>
            </div>
          </Panel>

          <Panel title="Table footprint" icon={<TableProperties size={15} />} eyebrow={`${connection.tables.length} table(s) visible`}>
            {connection.tables.length === 0 ? (
              <EmptyState
                title="No table metadata yet"
                description="Table-level MAR comes from Fivetran's Platform Connector. It appears after the first metadata sync completes (up to one hour after setup)."
              />
            ) : (
              <div className="space-y-3">
                {connection.tables.map((table) => (
                  <div
                    key={`${table.schema}.${table.name}`}
                    className="rounded-lg border px-4 py-3"
                    style={{ borderColor: "rgba(16,24,26,0.08)", background: "rgba(16,24,26,0.02)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">{table.name}</p>
                        <p className="mt-1 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                          {table.schema} · {formatCompact(table.monthlyMar)} MAR · {table.queryCount30d} downstream query hits / 30d
                        </p>
                      </div>
                      <StatusBadge status={table.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Recent actions" icon={<History size={15} />} eyebrow={`${connection.actions.length} action(s) logged`}>
            {connection.actions.length === 0 ? (
              <EmptyState
                title="No actions yet"
                description="This list fills when the agent proposes or executes a change for this connector. Trigger one from the Command Center with Run portfolio audit."
              />
            ) : (
              <div className="space-y-3">
                {connection.actions.map((action) => (
                  <div key={action.id} className="rounded-lg px-4 py-3" style={{ borderLeft: `3px solid ${SIGNAL}`, background: "rgba(16,24,26,0.03)" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ ...monoStyle, color: MUTED }}>
                      {action.subAgent} · {action.status}
                    </p>
                    <p className="mt-1 text-[13px] font-semibold">{action.actionType.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-[12px] leading-6" style={{ ...monoStyle, color: MUTED }}>
                      {action.geminiReasoning || "No additional reasoning stored."}
                    </p>
                    <p className="mt-1 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                      {formatDateTime(action.timestamp)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Recent sync history" icon={<History size={15} />} eyebrow={`${connection.syncHistory.length} sync record(s)`}>
            {connection.syncHistory.length === 0 ? (
              <EmptyState
                title="No sync history yet"
                description="Sync records come from Fivetran's metadata log and appear after the Platform Connector's next sync."
              />
            ) : (
              <div className="space-y-3">
                {connection.syncHistory.map((sync) => (
                  <div key={sync.id} className="rounded-lg border px-4 py-3" style={{ borderColor: "rgba(16,24,26,0.08)", background: "rgba(16,24,26,0.02)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-semibold">{sync.status}</p>
                        <p className="mt-1 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                          Started {formatDateTime(sync.startedAt)}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold" style={{ ...monoStyle, color: SIGNAL }}>
                        {sync.durationMin}m
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="MAR history" eyebrow={`${connection.marHistory.length} month point(s)`}>
            {connection.marHistory.length === 0 ? (
              <EmptyState
                title="No MAR history yet"
                description="MAR accrues monthly. The first data point appears once Fivetran reports active rows for the current month."
              />
            ) : (
              <div className="space-y-2">
                {connection.marHistory.map((point) => (
                  <div key={point.date} className="flex items-center justify-between border-b py-2 last:border-b-0" style={{ borderColor: "rgba(16,24,26,0.08)" }}>
                    <span className="text-[12px]" style={{ ...monoStyle, color: MUTED }}>{point.date}</span>
                    <span className="text-[12px] font-semibold" style={{ ...monoStyle, color: SIGNAL }}>{formatCompact(point.mar)} MAR</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}