import Link from "next/link";
import { Cable, ShieldCheck, Wallet } from "lucide-react";
import { getPortfolio, getSpend } from "@/lib/api";
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
  formatCurrency,
  monoStyle,
} from "../components/ops-ui";

export const dynamic = "force-dynamic";

export default async function SpendPage() {
  const result = await Promise.all([getSpend(), getPortfolio()])
    .then(([spend, portfolio]) => ({ value: { spend, portfolio }, error: null as Error | null }))
    .catch((error: unknown) => ({
      value: null,
      error: error instanceof Error ? error : new Error("The spend view could not be loaded."),
    }));

  if (result.error || !result.value) {
    return (
      <BackendErrorState
        title="Spend view unavailable"
        message={result.error?.message || "The spend view could not be loaded."}
      />
    );
  }

  const { spend, portfolio } = result.value;
  const totalTeamMar = spend.teams.reduce((sum, team) => sum + team.monthlyMar, 0);
  const expensiveConnections = [...portfolio.connections]
    .sort((left, right) => right.monthlyMarCurrent - left.monthlyMarCurrent)
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        eyebrow={`Estimated at ${formatCurrency(spend.marUsdPerMillion)} per 1M MAR`}
        title="Spend and chargeback"
        description="USD is intentionally estimated from MAR because Fivetran billing is not exposed line-by-line. The connector ranking and team attribution are real from the portfolio and policy state."
        actions={
          <>
            <PageButton href="/settings" inverse>
              <ShieldCheck size={13} />
              Policy owners
            </PageButton>
            <PageButton href="/connectors">
              <Cable size={13} />
              Connector portfolio
            </PageButton>
          </>
        }
      />

      <div className="space-y-5">
        <Panel title="Team allocation" icon={<Wallet size={15} />} eyebrow={`${spend.teams.length} team(s)`}>
          {spend.teams.length === 0 ? (
            <EmptyState
              title="No team allocation yet"
              description="Spend will appear here once policies exist and connectors are assigned to owners."
              href="/settings"
              actionLabel="Open settings"
            />
          ) : (
            <div className="space-y-3">
              {spend.teams.map((team) => {
                const sharePct = totalTeamMar > 0 ? Math.round((team.monthlyMar / totalTeamMar) * 100) : 0;
                return (
                  <div
                    key={team.teamOwner}
                    className="rounded-lg border px-4 py-3"
                    style={{ borderColor: "rgba(16,24,26,0.08)", background: "rgba(16,24,26,0.02)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[14px] font-semibold uppercase tracking-[0.08em]">{team.teamOwner}</p>
                        <p className="mt-1 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                          {team.connections} connector(s) · {formatCompact(team.monthlyMar)} MAR · {sharePct}% of spend
                        </p>
                      </div>
                      <span className="text-[12px] font-semibold" style={{ ...monoStyle, color: SIGNAL }}>
                        {formatCurrency(team.estimatedUsd)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(16,24,26,0.08)" }}>
                      <div className="h-full rounded-full" style={{ width: `${sharePct}%`, background: SIGNAL }} />
                    </div>
                    <p className="mt-2 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                      Executed savings: {formatCompact(team.executedSavingsMar)} MAR
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Highest MAR connectors" icon={<Cable size={15} />} eyebrow={`${expensiveConnections.length} ranked connector(s)`}>
          {expensiveConnections.length === 0 ? (
            <EmptyState
              title="No connector spend yet"
              description="As soon as connectors exist and metadata is flowing, Conductor will rank the largest MAR drivers here."
            />
          ) : (
            <div className="space-y-3">
              {expensiveConnections.map((connection) => (
                <Link
                  key={connection.id}
                  href={`/connectors/${connection.id}`}
                  className="block rounded-lg border px-4 py-3 transition hover:bg-black/3"
                  style={{ borderColor: "rgba(16,24,26,0.08)", background: "rgba(16,24,26,0.02)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">{connection.displayName || connection.name}</p>
                        <p className="mt-1 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                          ID: {connection.id} · {connection.teamOwner} · {connection.connectorType}
                        </p>
                    </div>
                    <StatusBadge status={connection.healthStatus} />
                  </div>
                  <div className="mt-2 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
                    {formatCompact(connection.monthlyMarCurrent)} MAR current load
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}