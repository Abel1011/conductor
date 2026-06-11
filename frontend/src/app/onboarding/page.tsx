import { Bell, Cable, ListChecks } from "lucide-react";
import { getNotificationSettings, getOnboarding, type NotificationSettings } from "@/lib/api";
import {
  BackendErrorState,
  MUTED,
  PageButton,
  PageHeader,
  Panel,
  SIGNAL,
  monoStyle,
} from "../components/ops-ui";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: "Connected",
  CONNECTED_NO_CONNECTORS: "Connected — no connectors yet",
  MISSING_ENV_CONFIGURATION: "Not connected",
};

const NOTIFICATION_CHANNELS: Array<{
  key: keyof NotificationSettings;
  name: string;
  envHint: string;
}> = [
  { key: "slack", name: "Slack", envHint: "SLACK_BOT_TOKEN + SLACK_CHANNEL_ID" },
  { key: "discord", name: "Discord", envHint: "DISCORD_WEBHOOK_URL" },
  { key: "email", name: "Email", envHint: "RESEND_API_KEY + NOTIFY_EMAIL_TO" },
];

export default async function OnboardingPage() {
  const result = await getOnboarding()
    .then((value) => ({ value, error: null as Error | null }))
    .catch((error: unknown) => ({
      value: null,
      error: error instanceof Error ? error : new Error("The setup status could not be loaded."),
    }));

  if (result.error || !result.value) {
    return (
      <BackendErrorState
        title="Setup unavailable"
        message={result.error?.message || "The setup status could not be loaded."}
      />
    );
  }

  const onboarding = result.value;
  const status = STATUS_LABEL[onboarding.fivetran.connectionStatus] || onboarding.fivetran.connectionStatus;
  const notificationSettings = await getNotificationSettings().catch(() => null);

  return (
    <div>
      <PageHeader
        eyebrow={`Stage · ${onboarding.workflow.currentStage}`}
        title="Setup"
        description="Conductor sits on top of your Fivetran account: it discovers your existing connectors, reads their usage metadata, and governs them through the Fivetran API. Nothing is created here — connectors are managed in Fivetran; Conductor adds the intelligence layer."
        actions={
          <PageButton href="/connectors" inverse>
            <Cable size={13} />
            Connector portfolio
          </PageButton>
        }
      />

      <div className="space-y-5">
        <Panel title="Fivetran account" icon={<Cable size={15} />} eyebrow={onboarding.fivetran.accountLabel}>
          <div className="space-y-2.5 text-[12px]" style={{ ...monoStyle, color: MUTED }}>
            <p>Status: <span style={{ color: "#10181A" }}>{status}</span></p>
            <p>Connectors discovered: <span style={{ color: "#10181A" }}>{onboarding.fivetran.connectorCount}</span></p>
            <p>Types: <span style={{ color: "#10181A" }}>{onboarding.fivetran.connectorTypes.join(", ") || "—"}</span></p>
          </div>
          <div className="mt-4 space-y-2.5 border-t pt-4 text-[12px] leading-5" style={{ borderColor: "rgba(16,24,26,0.08)", ...monoStyle, color: MUTED }}>
            <p>
              <span style={{ color: "#10181A" }}>Already use Fivetran?</span> Add your API key to the backend
              environment. Conductor discovers every connector automatically.
            </p>
            <p>
              <span style={{ color: "#10181A" }}>Starting from zero?</span> Create your connectors in Fivetran first
              (plus the free Platform Connector for usage metadata), then they appear here.
            </p>
          </div>
        </Panel>

        <Panel title="Notifications" icon={<Bell size={15} />} eyebrow="Where Conductor sends operational notices">
          <div className="space-y-3">
            {NOTIFICATION_CHANNELS.map((channel) => {
              const state = notificationSettings?.[channel.key];
              const configured = state?.configured ?? false;
              return (
                <div
                  key={channel.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
                  style={{
                    borderColor: configured ? "rgba(11,138,92,0.25)" : "rgba(16,24,26,0.08)",
                    background: configured ? "rgba(11,138,92,0.05)" : "rgba(16,24,26,0.02)",
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold">{channel.name}</p>
                    <p className="mt-0.5 text-[10.5px]" style={{ ...monoStyle, color: MUTED }}>
                      {configured && state?.target
                        ? `Target: ${state.target}`
                        : `Configure via ${channel.envHint} in the backend environment`}
                    </p>
                  </div>
                  <span
                    className="rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
                    style={{
                      ...monoStyle,
                      background: configured ? "rgba(11,138,92,0.10)" : "rgba(16,24,26,0.06)",
                      color: configured ? SIGNAL : MUTED,
                    }}
                  >
                    {configured ? "Active" : "Not set"}
                  </span>
                </div>
              );
            })}
            <p className="text-[11px] leading-5" style={{ ...monoStyle, color: MUTED }}>
              The dispatch pipeline is always live: every approval, executed action, failure and alert goes through it
              in real time (you see the in-app toast and the activity entry either way). “Not set” only means that
              channel has no credentials yet, so the external API call is skipped — add the env vars above and it
              flips to Active with zero code changes.
            </p>
          </div>
        </Panel>

        <Panel title="Setup checklist" icon={<ListChecks size={15} />} eyebrow="Three steps to operational">
          <div className="space-y-4">
            {onboarding.workflow.steps.map((step) => (
              <div
                key={step.id}
                className="rounded-lg px-4 py-3"
                style={{
                  borderLeft: `3px solid ${step.status === "DONE" ? SIGNAL : "rgba(16,24,26,0.18)"}`,
                  background: step.status === "CURRENT" ? "rgba(11,138,92,0.06)" : "rgba(16,24,26,0.02)",
                }}
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ ...monoStyle, color: step.status === "CURRENT" ? SIGNAL : MUTED }}>
                  {step.status}
                </p>
                <p className="mt-1 text-[15px] font-semibold">{step.title}</p>
                <p className="mt-1 text-[13px] leading-6" style={{ ...monoStyle, color: MUTED }}>
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}