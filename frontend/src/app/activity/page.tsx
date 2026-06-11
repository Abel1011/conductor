import Link from "next/link";
import { Bell, ClipboardCheck } from "lucide-react";
import { getActions, getNotificationSettings, type NotificationSettings } from "@/lib/api";
import {
  AMBER,
  BackendErrorState,
  EmptyState,
  INK,
  MUTED,
  PageButton,
  PageHeader,
  RED,
  SIGNAL,
  formatCompact,
  formatDateTime,
  monoStyle,
} from "../components/ops-ui";
import { LiveRefresh } from "../components/live-refresh";
import { AgentTrace } from "../components/agent-trace";
import { RevertActionButton } from "../components/revert-action-button";

function buildConnectorLabel(connectionId: string, connectionName?: string | null) {
  return {
    displayName: connectionName || connectionId,
    technicalId: connectionId,
  };
}

function describeNotificationTargets(settings: NotificationSettings | null) {
  const entries: Array<{ name: string; configured: boolean; target: string | null }> = [
    { name: "Slack", configured: settings?.slack.configured ?? false, target: settings?.slack.target ?? null },
    { name: "Discord", configured: settings?.discord.configured ?? false, target: null },
    { name: "Email", configured: settings?.email.configured ?? false, target: settings?.email.target ?? null },
  ];
  return entries.map((entry) => ({
    ...entry,
    label: entry.configured && entry.target ? `${entry.name} (${entry.target})` : entry.name,
  }));
}

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  EXECUTED: SIGNAL,
  PENDING_APPROVAL: AMBER,
  REJECTED: MUTED,
  FAILED: RED,
  ROLLED_BACK: RED,
};

export default async function ActivityPage() {
  const result = await getActions(50)
    .then((actions) => ({ value: { actions }, error: null as Error | null }))
    .catch((error: unknown) => ({
      value: null,
      error: error instanceof Error ? error : new Error("The activity log could not be loaded."),
    }));

  const notificationSettings = await getNotificationSettings().catch(() => null);
  const notificationTargets = describeNotificationTargets(notificationSettings);

  if (result.error || !result.value) {
    return (
      <BackendErrorState
        title="Activity log unavailable"
        message={result.error?.message || "The activity log could not be loaded."}
      />
    );
  }

  const { actions } = result.value;

  return (
    <div>
      <LiveRefresh />
      <PageHeader
        eyebrow={`${actions.length} recorded action(s)`}
        title="Action activity"
        description="The persisted audit trail for Conductor: every action proposed or executed by the agent, with reasoning, impact, status, and linked trace when available."
        actions={
          <PageButton href="/approvals" inverse>
            <ClipboardCheck size={13} />
            Pending approvals
          </PageButton>
        }
      />

      <div className="space-y-5">
        {actions.length === 0 ? (
          <EmptyState
            title="No agent activity yet"
            description="Run a portfolio audit from the Command Center to generate the first analysis."
            href="/"
            actionLabel="Go to Command Center"
          />
        ) : (
          <section
            className="overflow-hidden rounded-lg border p-4 sm:p-5"
            style={{ borderColor: "rgba(16,24,26,0.08)", background: "#F8FAF8", boxShadow: "0 1px 2px rgba(16,24,26,0.05)" }}
          >
            <div className="space-y-4">
              {(() => {
                // Group actions that belong to the same agent run + connection +
                // action type so the shared reasoning and trace are shown once,
                // with each individual action (e.g. per table) listed as a row.
                const groupKeyOf = (action: (typeof actions)[number]) => {
                  const runId = action.actionPayload?.runId;
                  return typeof runId === "string"
                    ? `${runId}|${action.connectionId}|${action.actionType}`
                    : action.id;
                };
                const groups: Array<typeof actions> = [];
                const groupIndex = new Map<string, number>();
                for (const action of actions) {
                  const key = groupKeyOf(action);
                  const idx = groupIndex.get(key);
                  if (idx === undefined) {
                    groupIndex.set(key, groups.length);
                    groups.push([action]);
                  } else {
                    groups[idx].push(action);
                  }
                }

                const tableLabelOf = (action: (typeof actions)[number]) => {
                  const tables = action.actionPayload?.tables;
                  if (Array.isArray(tables) && tables.length > 0) {
                    const table = tables[0] as { schemaName?: string; tableName?: string };
                    if (table?.tableName) {
                      return `${table.schemaName ? `${table.schemaName}.` : ""}${table.tableName}`;
                    }
                  }
                  return null;
                };

                return groups.map((group) => {
                const lead = group[0];
                const connector = buildConnectorLabel(lead.connectionId, lead.connectionName);
                const runId = typeof lead.actionPayload?.runId === "string" ? lead.actionPayload.runId : null;
                // The group's status accent: red if any failed/rolled back, amber if any pending, else green.
                const groupStatus = group.some((a) => a.status === "FAILED" || a.status === "ROLLED_BACK")
                  ? "FAILED"
                  : group.some((a) => a.status === "PENDING_APPROVAL")
                    ? "PENDING_APPROVAL"
                    : "EXECUTED";
                const statusColor = STATUS_COLOR[groupStatus] || MUTED;
                const totalSavings = group.reduce(
                  (sum, a) => sum + (Number(a.actionPayload?.estimatedMarSavings) || 0),
                  0
                );
                return (
                  <div
                    key={lead.id}
                    className="rounded-lg px-4 py-3"
                    style={{
                      borderLeft: `3px solid ${statusColor}`,
                      background: groupStatus === "FAILED"
                        ? "rgba(192,58,43,0.05)"
                        : groupStatus === "PENDING_APPROVAL"
                          ? "rgba(176,120,22,0.05)"
                          : "rgba(16,24,26,0.03)",
                    }}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[14px] font-semibold">
                        {lead.actionType.replaceAll("_", " ")} ·{" "}
                        <Link href={`/connectors/${lead.connectionId}`} style={{ color: SIGNAL }}>
                          {connector.displayName}
                        </Link>
                        {group.length > 1 ? (
                          <span className="ml-1.5 text-[11px] font-normal" style={{ ...monoStyle, color: MUTED }}>
                            ({group.length} tables)
                          </span>
                        ) : null}
                      </p>
                      {group.length === 1 ? (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ ...monoStyle, color: statusColor }}>
                          {lead.status.replaceAll("_", " ")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em]" style={{ ...monoStyle, color: MUTED }}>
                      {lead.subAgent}
                      {connector.displayName !== connector.technicalId ? ` · id: ${connector.technicalId}` : ""}
                      {lead.triggerEvent ? ` · trigger: ${lead.triggerEvent}` : ""} · {formatDateTime(lead.timestamp)}
                    </p>
                    {lead.geminiReasoning ? (
                      <p className="mt-2 text-[13px] leading-6" style={{ color: MUTED }}>
                        {lead.geminiReasoning}
                      </p>
                    ) : null}
                    {group.length === 1 ? (
                      <div className="mt-2 flex flex-wrap gap-4 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                        {lead.actionPayload?.estimatedMarSavings !== undefined && lead.actionPayload?.estimatedMarSavings !== null ? (
                          <span>
                            Est. savings: <span style={{ color: SIGNAL }}>{formatCompact(Number(lead.actionPayload.estimatedMarSavings))} MAR</span>
                          </span>
                        ) : null}
                        {lead.impactMarBefore !== null && lead.impactMarBefore !== undefined ? (
                          <span>
                            MAR before/after: {formatCompact(Number(lead.impactMarBefore))} →{" "}
                            {lead.impactMarAfter !== null && lead.impactMarAfter !== undefined
                              ? formatCompact(Number(lead.impactMarAfter))
                              : "pending verification"}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ ...monoStyle, color: MUTED }}>
                          {group.length} actions in this run · total est. savings{" "}
                          <span style={{ color: SIGNAL }}>{formatCompact(totalSavings)} MAR</span>
                        </p>
                        {group.map((action) => {
                          const rowStatusColor = STATUS_COLOR[action.status] || MUTED;
                          const rowSavings = action.actionPayload?.estimatedMarSavings;
                          return (
                            <div
                              key={action.id}
                              className="flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                              style={{ borderColor: "rgba(16,24,26,0.08)", background: "#FDFDFC" }}
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[12px] font-semibold" style={{ ...monoStyle, color: INK }}>
                                  {tableLabelOf(action) ?? action.actionType.replaceAll("_", " ")}
                                </p>
                                <p className="mt-0.5 flex flex-wrap gap-3 text-[10.5px]" style={{ ...monoStyle, color: MUTED }}>
                                  {rowSavings !== undefined && rowSavings !== null ? (
                                    <span>
                                      Saves <span style={{ color: SIGNAL }}>{formatCompact(Number(rowSavings))} MAR</span>/mo
                                    </span>
                                  ) : null}
                                  {action.impactMarBefore !== null && action.impactMarBefore !== undefined ? (
                                    <span>
                                      MAR {formatCompact(Number(action.impactMarBefore))} →{" "}
                                      {action.impactMarAfter !== null && action.impactMarAfter !== undefined
                                        ? formatCompact(Number(action.impactMarAfter))
                                        : "pending"}
                                    </span>
                                  ) : null}
                                </p>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-2.5">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ ...monoStyle, color: rowStatusColor }}>
                                  {action.status.replaceAll("_", " ")}
                                </span>
                                {action.status === "EXECUTED" ? (
                                  <RevertActionButton
                                    actionId={action.id}
                                    actionLabel={`disable ${tableLabelOf(action) ?? "this table"}`}
                                    connectorLabel={connector.displayName}
                                  />
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[10.5px]" style={{ ...monoStyle, color: MUTED }}>
                      <Bell size={11} style={{ color: SIGNAL }} />
                      Notice dispatched →{" "}
                      {notificationTargets.map((target, index) => (
                        <span key={target.name}>
                          {index > 0 ? " · " : ""}
                          {target.label}
                          {target.configured ? "" : " (not set)"}
                        </span>
                      ))}
                    </p>
                    {runId ? <AgentTrace runId={runId} /> : null}
                    {group.length === 1 && lead.status === "EXECUTED" ? (
                      <div className="mt-3">
                        <RevertActionButton
                          actionId={lead.id}
                          actionLabel={lead.actionType.replaceAll("_", " ").toLowerCase()}
                          connectorLabel={connector.displayName}
                        />
                      </div>
                    ) : null}
                  </div>
                );
                });
              })()}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
