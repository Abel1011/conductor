import { Cable, ShieldCheck } from "lucide-react";
import { getOnboarding, getPolicies, getWorkspaceSettings } from "@/lib/api";
import { PolicyEditor } from "../components/policy-editor";
import { GovernanceModeToggle } from "../components/governance-mode-toggle";
import {
  BackendErrorState,
  EmptyState,
  MUTED,
  PageButton,
  PageHeader,
  Panel,
  monoStyle,
} from "../components/ops-ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const result = await Promise.all([getPolicies(), getOnboarding(), getWorkspaceSettings()])
    .then(([policies, onboarding, settings]) => ({
      value: { policies, onboarding, settings },
      error: null as Error | null,
    }))
    .catch((error: unknown) => ({
      value: null,
      error: error instanceof Error ? error : new Error("The settings view could not be loaded."),
    }));

  if (result.error || !result.value) {
    return (
      <BackendErrorState
        title="Settings unavailable"
        message={result.error?.message || "The settings view could not be loaded."}
      />
    );
  }

  const { policies, onboarding, settings } = result.value;

  return (
    <div>
      <PageHeader
        eyebrow={`Fivetran · ${onboarding.fivetran.connectionStatus}`}
        title="Governance policies"
        description="These rules define what the agent is allowed to do per connector. Edit and save; the agent reads them on every audit."
        actions={
          <PageButton href="/connectors" inverse>
            <Cable size={13} />
            Connector portfolio
          </PageButton>
        }
      />

      <div className="space-y-5">
        <Panel title="Governance mode" icon={<ShieldCheck size={15} />} eyebrow="Applies to every new connector created in Fivetran">
          <GovernanceModeToggle initialMode={settings.governanceMode} />
        </Panel>

        <Panel title="How policies are enforced" icon={<ShieldCheck size={15} />} eyebrow="Agent guardrails">
          <div className="space-y-3 text-[12px] leading-5" style={{ ...monoStyle, color: MUTED }}>
            <p>
              <span style={{ color: "#10181A" }}>Governance mode</span> — Observe lets new connectors sync while a
              review is queued. Enforce pauses every new connector until a human approves it.
            </p>
            <p>
              <span style={{ color: "#10181A" }}>Enforcement is immediate</span> — only data syncs run on a schedule.
              Fivetran pushes platform events (connector created, schema changed, sync failed) to Conductor via webhook
              in real time, so in Enforce mode a new connector is paused within seconds — before its first sync moves
              any data.
            </p>
            <p>
              <span style={{ color: "#10181A" }}>SLA tier</span> — CRITICAL connectors are never touched by the agent.
              STANDARD and LOW can receive proposals.
            </p>
            <p>
              <span style={{ color: "#10181A" }}>MAR budget</span> — when monthly active rows exceed this limit, the
              connector is flagged OVER_BUDGET and prioritized for optimization.
            </p>
            <p>
              <span style={{ color: "#10181A" }}>Min cadence</span> — the agent will never schedule syncs more frequent
              than this floor.
            </p>
            <p>
              <span style={{ color: "#10181A" }}>Auto-execute low risk</span> — when enabled, LOW risk actions run
              without approval. MEDIUM and HIGH risk always require a human decision in Approvals.
            </p>
            <p>
              <span style={{ color: "#10181A" }}>Schema change protection</span> — when enabled, any schema event
              reported by Fivetran for this connector queues a human review before the change propagates downstream.
            </p>
            <p>
              <span style={{ color: "#10181A" }}>Custom policy</span> — free-text guardrails written in natural
              language. The agent reads them when reasoning about this connector, and while a custom policy exists
              every proposal requires human approval.
            </p>
          </div>
        </Panel>

        <Panel title="Connection policies" icon={<Cable size={15} />} eyebrow={`${policies.length} polic${policies.length === 1 ? "y" : "ies"} · editable`}>
          {policies.length === 0 ? (
            <EmptyState
              title="No policies configured"
              description="Conductor can discover connectors without policies, but the agent will not act until owners, budgets, and SLA tiers exist."
              href="/onboarding"
              actionLabel="Review setup"
            />
          ) : (
            <PolicyEditor policies={policies} />
          )}
        </Panel>
      </div>
    </div>
  );
}