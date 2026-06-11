import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Gauge,
  Inbox,
  ListChecks,
  Zap,
} from "lucide-react";
import { getCommandCenterData } from "@/lib/api";
import {
  AMBER,
  BackendErrorState,
  BudgetBar,
  EmptyState,
  MUTED,
  PageButton,
  PageHeader,
  Panel,
  RED,
  SIGNAL,
  StatGrid,
  StatusBadge,
  formatCompact,
  formatCurrency,
  formatRelative,
  monoStyle,
} from "./components/ops-ui";
import { ApprovalsClient } from "./components/approvals-client";
import { LiveRefresh } from "./components/live-refresh";
import { RunMissionButton } from "./components/run-mission-button";

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

function attentionScore(connection: { healthStatus: string; budgetPct: number; consecutiveFailures: number }) {
  return (
    (ATTENTION_WEIGHT[connection.healthStatus] ?? 0) * 10 +
    Math.min(connection.budgetPct, 200) / 10 +
    connection.consecutiveFailures
  );
}

const ACTION_STATUS_COLOR: Record<string, string> = {
  EXECUTED: SIGNAL,
  PENDING_APPROVAL: AMBER,
  REJECTED: MUTED,
  FAILED: RED,
  ROLLED_BACK: RED,
};

export default async function Page() {
  const result = await getCommandCenterData()
    .then((value) => ({ value, error: null as Error | null }))
    .catch((error: unknown) => ({
      value: null,
      error: error instanceof Error ? error : new Error("The frontend could not reach the backend API."),
    }));

  if (result.error || !result.value) {
    return (
      <BackendErrorState
        title="Command center unavailable"
        message={result.error?.message || "The frontend could not reach the backend API."}
      />
    );
  }

  const { summary, portfolio, approvals, alerts, workspaceContext, actions } = result.value;
  const attentionConnections = [...portfolio.connections]
    .sort((left, right) => attentionScore(right) - attentionScore(left))
    .slice(0, 5);
  const recentAlerts = alerts.slice(0, 4);
  const recentActions = actions.slice(0, 8);

  return (
    <div>
      <LiveRefresh />
      <PageHeader
        eyebrow={`${workspaceContext.fivetran.accountLabel} · ${workspaceContext.fivetran.connectionStatus} · ${portfolio.connections.length} connector(s)`}
        title="Command Center"
        description="What needs your attention right now: pending agent proposals, open incidents, and the live trail of every automated action Conductor has taken on Fivetran."
        actions={
          <>
            <RunMissionButton />
            <PageButton href="/approvals">
              <ListChecks size={13} />
              Open approvals
            </PageButton>
          </>
        }
      />

      <StatGrid
        items={[
          {
            label: "Pending review",
            value: String(summary.pendingApprovals),
            note: summary.pendingApprovals > 0 ? "Action required" : "Queue clear",
            noteColor: summary.pendingApprovals > 0 ? AMBER : SIGNAL,
            icon: <Inbox size={14} />,
          },
          {
            label: "Open alerts",
            value: String(summary.openAlerts),
            note: "Active incidents",
            noteColor: summary.openAlerts > 0 ? AMBER : MUTED,
            icon: <AlertTriangle size={14} />,
          },
          {
            label: "Total MAR",
            value: formatCompact(summary.totalMar),
            note: `${summary.budgetUsedPct}% of budget`,
            noteColor: summary.budgetUsedPct > 90 ? AMBER : MUTED,
            icon: <Database size={14} />,
          },
          {
            label: "Healthy",
            value: `${summary.healthyConnections}/${portfolio.connections.length}`,
            note: "Within policy",
            noteColor: SIGNAL,
            icon: <CheckCircle2 size={14} />,
          },
          {
            label: "Executed",
            value: String(summary.executedActions),
            note: "Real Fivetran actions",
            icon: <Zap size={14} />,
          },
          {
            label: "Savings",
            value: formatCurrency(summary.estimatedSavingsUsd),
            note: `${formatCompact(summary.estimatedSavingsMar)} MAR identified`,
            noteColor: SIGNAL,
            icon: <BadgeDollarSign size={14} />,
          },
        ]}
      />

      <div className="grid items-start gap-5 2xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <Panel
            title="Needs your decision"
            icon={<ClipboardCheck size={15} />}
            eyebrow={`${approvals.length} pending approval(s)`}
          >
            <ApprovalsClient initialApprovals={approvals} compact maxItems={4} />
          </Panel>

          <Panel title="Open alerts" icon={<AlertTriangle size={15} />} eyebrow={`${alerts.length} active alert(s)`}>
            {recentAlerts.length === 0 ? (
              <EmptyState
                title="No active alerts"
                description="No connector currently has an unresolved critical or warning condition."
              />
            ) : (
              <div className="space-y-3">
                {recentAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="rounded-lg px-4 py-3"
                    style={{
                      background: alert.severity === "CRITICAL" ? "rgba(192,58,43,0.05)" : "rgba(176,120,22,0.05)",
                      borderLeft: `3px solid ${alert.severity === "CRITICAL" ? RED : AMBER}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/connectors/${alert.connectionId}`}
                        className="text-[13px] font-semibold"
                        style={{ color: SIGNAL }}
                      >
                        {alert.connectionId}
                      </Link>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                        style={{ ...monoStyle, color: alert.severity === "CRITICAL" ? RED : AMBER }}
                      >
                        {alert.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-5" style={{ color: MUTED }}>
                      {alert.diagnosis}
                    </p>
                    {alert.recommendedAction ? (
                      <p className="mt-1 text-[12px] leading-5" style={{ color: MUTED }}>
                        Recommended: {alert.recommendedAction}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Agent activity" icon={<Activity size={15} />} eyebrow={`Last ${recentActions.length} automated action(s)`}>
            {recentActions.length === 0 ? (
              <EmptyState
                title="No actions yet"
                description="Run a portfolio audit to let the agent analyze the connector estate and propose optimizations."
              />
            ) : (
              <div className="space-y-3">
                {recentActions.map((action) => {
                  const statusColor = ACTION_STATUS_COLOR[action.status] || MUTED;
                  return (
                    <div key={action.id} className="border-l-2 pl-3" style={{ borderColor: statusColor }}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ ...monoStyle, color: statusColor }}>
                          {action.status.replaceAll("_", " ")}
                        </p>
                        <span className="text-[10px]" style={{ ...monoStyle, color: MUTED }}>
                          {formatRelative(action.timestamp)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13px] font-semibold">
                        {action.actionType.replaceAll("_", " ")} ·{" "}
                        <Link href={`/connectors/${action.connectionId}`} style={{ color: SIGNAL }}>
                          {action.connectionId}
                        </Link>
                      </p>
                      {action.geminiReasoning ? (
                        <p className="mt-0.5 line-clamp-2 text-[12px] leading-5" style={{ color: MUTED }}>
                          {action.geminiReasoning}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Portfolio attention" icon={<Gauge size={15} />} eyebrow="Connectors ranked by urgency">
            {attentionConnections.length === 0 ? (
              <EmptyState
                title="No connectors discovered"
                description="The account is connected, but no live connectors have been returned yet."
                href="/onboarding"
                actionLabel="See setup status"
              />
            ) : (
              <div className="space-y-3">
                {attentionConnections.map((connection) => (
                  <Link
                    key={connection.id}
                    href={`/connectors/${connection.id}`}
                    className="block rounded-lg border px-4 py-3 transition hover:bg-black/3"
                    style={{ borderColor: "rgba(16,24,26,0.1)", background: "#FDFDFC" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold">{connection.name}</p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em]" style={{ ...monoStyle, color: MUTED }}>
                          {connection.connectorType} · {connection.syncFrequencyMin}m · {formatRelative(connection.lastSuccessfulSyncAt)}
                        </p>
                      </div>
                      <StatusBadge status={connection.healthStatus} />
                    </div>
                    <div className="mt-3">
                      <BudgetBar
                        current={connection.monthlyMarCurrent}
                        budget={connection.monthlyMarBudget}
                        pct={connection.budgetPct}
                      />
                    </div>
                  </Link>
                ))}
                <Link
                  href="/connectors"
                  className="inline-block text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ ...monoStyle, color: SIGNAL }}
                >
                  View all connectors →
                </Link>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
