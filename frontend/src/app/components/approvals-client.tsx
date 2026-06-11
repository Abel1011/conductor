"use client";

import { startTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cable, ClipboardCheck, Workflow } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { approveApproval, rejectApproval, type Approval } from "@/lib/api";
import { AgentTrace } from "./agent-trace";
import {
  CONTROL_BUTTON_CLASSNAME,
  EmptyState,
  INK,
  LINE,
  LINE_SOFT,
  MUTED,
  Panel,
  RiskBadge,
  SIGNAL,
  formatCompact,
  formatRelative,
  monoStyle,
} from "./ops-ui";

type ConnectorLabel = {
  displayName: string;
  technicalId: string;
};

function buildConnectorLabel(connectionId: string, connectionName?: string | null) {
  return {
    displayName: connectionName || connectionId,
    technicalId: connectionId,
  } satisfies ConnectorLabel;
}

function JsonPreview({ payload }: { payload: Approval["actionPayload"] }) {
  if (!payload) {
    return null;
  }

  return (
    <pre
      className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border px-3 py-2.5 text-[10.5px] leading-5"
      style={{ ...monoStyle, borderColor: LINE_SOFT, background: "rgba(16,24,26,0.03)", color: MUTED }}
    >
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

function ReasoningMarkdown({ text }: { text: string }) {
  return (
    <div className="mt-2 text-[12.5px] leading-6" style={{ color: MUTED }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          strong: ({ children }) => <strong style={{ color: INK }}>{children}</strong>,
          code: ({ children }) => (
            <code className="rounded px-1 py-0.5 text-[11px]" style={{ ...monoStyle, background: "rgba(16,24,26,0.06)", color: INK }}>
              {children}
            </code>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

type PayloadTable = {
  schemaName?: string;
  tableName?: string;
  monthlyMar?: number;
};

function buildExecutionExplainer(approval: Approval): string[] {
  const payload = (approval.actionPayload ?? {}) as Record<string, unknown>;
  const savings = approval.estimatedMarSavings;
  const lines: string[] = [];

  switch (approval.actionType) {
    case "BLOCK_TABLE": {
      const tables: PayloadTable[] = Array.isArray(payload.tables)
        ? (payload.tables as PayloadTable[])
        : payload.table
          ? [{ schemaName: payload.schema as string | undefined, tableName: payload.table as string }]
          : [];
      const names = tables
        .map((t) => `${t.schemaName ? `${t.schemaName}.` : ""}${t.tableName}${typeof t.monthlyMar === "number" ? ` (${formatCompact(t.monthlyMar)} MAR/mo)` : ""}`)
        .join(", ");
      lines.push(
        `On approve, Conductor calls the Fivetran API to stop syncing ${tables.length || "the listed"} table(s)${names ? `: ${names}` : ""}.`
      );
      lines.push(
        "Data already loaded in BigQuery is kept \u2014 only future syncs stop. The table(s) can be re-enabled from Fivetran at any time."
      );
      break;
    }
    case "CHANGE_FREQUENCY": {
      const freq = payload.newSyncFrequencyMin ?? payload.frequencyMin;
      lines.push(
        `On approve, Conductor calls the Fivetran API to change this connector's sync frequency${freq ? ` to every ${freq} minutes` : ""}.`
      );
      lines.push("Fewer syncs per day means fewer rows counted as active \u2014 no data is deleted or paused.");
      break;
    }
    case "PAUSE": {
      lines.push("On approve, Conductor calls the Fivetran API to pause this connector entirely \u2014 no new data will sync until it is resumed.");
      lines.push("Existing data in BigQuery is untouched, and the connector can be resumed at any time.");
      break;
    }
    default: {
      lines.push(`On approve, Conductor executes a ${approval.actionType.replaceAll("_", " ").toLowerCase()} action against the Fivetran API for this connector.`);
    }
  }

  if (savings > 0) {
    lines.push(`Estimated impact: about ${formatCompact(savings)} fewer monthly active rows billed per month.`);
  }

  return lines;
}

function approvalTableLabel(approval: Approval): string | null {
  const tables = approval.actionPayload?.tables;
  if (Array.isArray(tables) && tables.length > 0) {
    const table = tables[0] as PayloadTable;
    if (table?.tableName) {
      return `${table.schemaName ? `${table.schemaName}.` : ""}${table.tableName}`;
    }
  }
  return null;
}

export function ApprovalsClient({
  initialApprovals,
  compact = false,
  maxItems,
}: {
  initialApprovals: Approval[];
  compact?: boolean;
  maxItems?: number;
}) {
  const router = useRouter();
  const [approvals, setApprovals] = useState(initialApprovals);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolveApproval(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);

    try {
      if (action === "approve") {
        await approveApproval(id);
      } else {
        await rejectApproval(id);
      }

      setApprovals((current) => current.filter((approval) => approval.id !== id));
      startTransition(() => {
        router.refresh();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to resolve the approval.");
    } finally {
      setBusyId(null);
    }
  }

  if (approvals.length === 0) {
    return (
      <EmptyState
        title="Approval queue clear"
        description="No pending actions need human review right now. When the agent proposes a medium or high-risk change, it will appear here."
        href={compact ? "/approvals" : "/connectors"}
        actionLabel={compact ? "Open approvals page" : "Review connectors"}
      />
    );
  }

  const visibleApprovals = maxItems ? approvals.slice(0, maxItems) : approvals;

  if (compact) {
    return (
      <div className="space-y-3">
        {error ? (
          <div className="border px-4 py-3 text-[12px]" style={{ ...monoStyle, borderColor: LINE, color: "#C03A2B" }}>
            {error}
          </div>
        ) : null}
        {visibleApprovals.map((approval) => {
          const busy = busyId === approval.id;
          const connector = buildConnectorLabel(approval.connectionId, approval.connectionName);
          return (
            <div
              key={approval.id}
              className="flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border"
              style={{ borderColor: "rgba(16,24,26,0.08)", background: "#FDFDFC", boxShadow: "0 1px 2px rgba(16,24,26,0.04)" }}
            >
              <div className="h-full self-stretch w-1 flex-shrink-0" style={{
                background: approval.riskLevel === "HIGH" ? "#C03A2B" : approval.riskLevel === "MEDIUM" ? "#B07816" : "#0B8A5C"
              }} />

              <div className="min-w-0 flex-1 py-3 pr-1">
                <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em]" style={{ ...monoStyle, color: MUTED }}>
                  <Link href={`/connectors/${approval.connectionId}`} style={{ color: SIGNAL }}>
                    {connector.displayName}
                  </Link>
                  {" · "}{formatRelative(approval.createdAt)}
                </p>
                {connector.displayName !== connector.technicalId ? (
                  <p className="mt-0.5 text-[10px]" style={{ ...monoStyle, color: MUTED }}>
                    ID: {connector.technicalId}
                  </p>
                ) : null}
                <p className="mt-0.5 truncate text-[13px] font-semibold leading-5">{approval.title}</p>
                {approval.estimatedMarSavings > 0 ? (
                  <p className="mt-0.5 text-[10.5px]" style={{ ...monoStyle, color: MUTED }}>
                    Saves <span style={{ color: SIGNAL }}>{formatCompact(approval.estimatedMarSavings)} MAR</span>
                  </p>
                ) : null}
              </div>

              <div className="flex flex-shrink-0 items-center gap-2 py-3 pr-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resolveApproval(approval.id, "reject")}
                  className="rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition hover:bg-black/5 disabled:opacity-50"
                  style={{ ...monoStyle, borderColor: LINE, color: MUTED }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resolveApproval(approval.id, "approve")}
                  className="rounded-lg px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white transition hover:opacity-90 disabled:opacity-50"
                  style={{ ...monoStyle, background: SIGNAL }}
                >
                  {busy ? "…" : "Approve"}
                </button>
              </div>
            </div>
          );
        })}
        {approvals.length > visibleApprovals.length ? (
          <Link href="/approvals" className="inline-block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ ...monoStyle, color: SIGNAL }}>
            View all {approvals.length} pending →
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div
          className="rounded-lg border px-4 py-3 text-[12px]"
          style={{ ...monoStyle, borderColor: LINE, background: "rgba(192,58,43,0.04)", color: MUTED }}
        >
          {error}
        </div>
      ) : null}
      <div className="space-y-4">
        {(() => {
          const groupKeyOf = (a: Approval) => {
            const groupRunId = a.actionPayload?.runId;
            return typeof groupRunId === "string" ? `${groupRunId}|${a.connectionId}|${a.actionType}` : a.id;
          };
          const groups: Approval[][] = [];
          const groupIndex = new Map<string, number>();
          for (const approval of approvals) {
            const key = groupKeyOf(approval);
            const idx = groupIndex.get(key);
            if (idx === undefined) {
              groupIndex.set(key, groups.length);
              groups.push([approval]);
            } else {
              groups[idx].push(approval);
            }
          }
          return (
            <div className="grid gap-4">
                {groups.map((group) => {
          const lead = group[0];
          const connector = buildConnectorLabel(lead.connectionId, lead.connectionName);
          const totalSavings = group.reduce((sum, a) => sum + (a.estimatedMarSavings || 0), 0);
          const mergedTables = group.flatMap((a) =>
            Array.isArray(a.actionPayload?.tables) ? (a.actionPayload.tables as PayloadTable[]) : []
          );
          const merged: Approval = group.length > 1
            ? {
                ...lead,
                estimatedMarSavings: totalSavings,
                actionPayload: { ...lead.actionPayload, tables: mergedTables },
              }
            : lead;
          const groupTitle = group.length > 1
            ? lead.actionType === "BLOCK_TABLE"
              ? `Disable ${group.length} cold tables on ${connector.displayName}`
              : `${lead.actionType.replaceAll("_", " ")} \u00b7 ${group.length} proposed changes on ${connector.displayName}`
            : lead.title;
          return (
            <Panel
              key={lead.id}
              title={groupTitle}
              icon={<ClipboardCheck size={15} />}
              eyebrow={`${lead.subAgent} · ${lead.actionType.replaceAll("_", " ")} · ${formatRelative(lead.createdAt)}`}
              className="h-full"
            >
              <div className="flex h-full flex-col gap-4">
                <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: LINE_SOFT }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ ...monoStyle, color: MUTED }}>
                      Decision summary
                    </p>
                    <p className="mt-2 min-w-0 text-[13px] leading-6" style={{ color: MUTED }}>
                      {lead.description}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 justify-start sm:justify-end">
                    <RiskBadge riskLevel={lead.riskLevel} />
                  </div>
                </div>

                <div className="space-y-3">
                  <div
                    className="rounded-lg border px-3.5 py-3"
                    style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.02)" }}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ ...monoStyle, color: MUTED }}>
                      Context
                    </p>
                    <Link
                      href={`/connectors/${lead.connectionId}`}
                      className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
                      style={{ color: SIGNAL }}
                    >
                      <Cable size={13} />
                      {connector.displayName}
                    </Link>
                    {connector.displayName !== connector.technicalId ? (
                      <p className="mt-1 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                        ID: {connector.technicalId}
                      </p>
                    ) : null}
                    <div className="mt-3 grid gap-2 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                      <span>
                        Action type: <span style={{ color: INK }}>{lead.actionType.replaceAll("_", " ")}</span>
                      </span>
                      <span>
                        Agent: <span style={{ color: INK }}>{lead.subAgent}</span>
                      </span>
                      <span>
                        Est. savings: <span style={{ color: SIGNAL }}>{formatCompact(totalSavings)} MAR</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  className="rounded-lg border px-3.5 py-3"
                  style={{ borderColor: "rgba(11,138,92,0.14)", background: "rgba(11,138,92,0.06)" }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ ...monoStyle, color: SIGNAL }}>
                    Agent reasoning
                  </p>
                  <ReasoningMarkdown text={lead.geminiReasoning ?? ""} />
                </div>

                {merged.actionPayload ? (
                  <div
                    className="rounded-lg border px-3.5 py-3"
                    style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.02)" }}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ ...monoStyle, color: MUTED }}>
                      What will execute on approve
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {buildExecutionExplainer(merged).map((line) => (
                        <p key={line} className="text-[12.5px] leading-6" style={{ color: MUTED }}>
                          {line}
                        </p>
                      ))}
                    </div>
                    {group.length > 1 ? (
                      <p className="mt-2 text-[12px] leading-5" style={{ color: MUTED }}>
                        Each table below has its own approve / reject decision — you can accept some and reject others.
                      </p>
                    ) : null}
                    <details className="mt-2">
                      <summary
                        className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.14em]"
                        style={{ ...monoStyle, color: MUTED }}
                      >
                        Raw payload (JSON)
                      </summary>
                      <JsonPreview payload={merged.actionPayload} />
                    </details>
                  </div>
                ) : null}

                <div
                  className="mt-auto flex flex-col gap-2 border-t pt-4"
                  style={{ borderColor: LINE_SOFT }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ ...monoStyle, color: MUTED }}>
                      {group.length > 1 ? "Decide each change individually" : "Decision"}
                    </p>
                    <span className="text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                      Total est. savings:{" "}
                      <span className="font-semibold" style={{ color: SIGNAL }}>
                        {formatCompact(totalSavings)} MAR
                      </span>
                    </span>
                  </div>
                  {group.map((approval) => {
                    const busy = busyId === approval.id;
                    const rowLabel = approvalTableLabel(approval) ?? approval.title;
                    return (
                      <div
                        key={approval.id}
                        className="flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                        style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.02)" }}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold" style={{ ...monoStyle, color: INK }}>
                            {rowLabel}
                          </p>
                          {approval.estimatedMarSavings > 0 ? (
                            <p className="mt-0.5 text-[10.5px]" style={{ ...monoStyle, color: MUTED }}>
                              Saves <span style={{ color: SIGNAL }}>{formatCompact(approval.estimatedMarSavings)} MAR</span>/mo
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-shrink-0 gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void resolveApproval(approval.id, "reject")}
                            className={`${CONTROL_BUTTON_CLASSNAME} disabled:opacity-50`}
                            style={{ ...monoStyle, borderColor: LINE, background: "#FFFFFF", color: MUTED }}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void resolveApproval(approval.id, "approve")}
                            className={`${CONTROL_BUTTON_CLASSNAME} disabled:opacity-50`}
                            style={{ ...monoStyle, borderColor: SIGNAL, background: SIGNAL, color: "#F8FAF8" }}
                          >
                            {busy ? "Working…" : "Approve"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {lead.actionPayload?.runId ? (
                  <div className="border-t pt-4" style={{ borderColor: LINE_SOFT }}>
                    <div className="flex items-center gap-2">
                      <Workflow size={13} style={{ color: MUTED }} />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ ...monoStyle, color: MUTED }}>
                        Agent trace
                      </p>
                    </div>
                    <AgentTrace runId={lead.actionPayload.runId as string} />
                  </div>
                ) : null}
              </div>
            </Panel>
          );
                })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}