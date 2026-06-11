"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, FileText, ShieldAlert, ShieldCheck, Users, Zap } from "lucide-react";
import { updatePolicy, type Policy } from "@/lib/api";
import { AMBER, CONTROL_BUTTON_CLASSNAME, INK, LINE_SOFT, MUTED, RED, SIGNAL, monoStyle } from "./ops-ui";

const SLA_TIERS = ["CRITICAL", "STANDARD", "LOW"] as const;
const FREQUENCIES = [15, 30, 60, 120, 360, 720, 1440];

const TIER_META: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: RED, bg: "rgba(192,58,43,0.10)", label: "Critical" },
  STANDARD: { color: AMBER, bg: "rgba(176,120,22,0.10)", label: "Standard" },
  LOW: { color: SIGNAL, bg: "rgba(11,138,92,0.10)", label: "Low" },
};

const fieldLabelClass = "text-[10px] font-semibold uppercase tracking-[0.16em]";
const inputBaseClass =
  "w-full rounded-lg border bg-white px-3 py-2.5 text-[12px] font-medium leading-none outline-none transition focus:border-[#10181A] focus:ring-2 focus:ring-[#10181A]/10";

function formatCadence(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return "Daily";
}

function FieldShell({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5" style={{ color: MUTED }}>
        {icon}
        <span className={fieldLabelClass} style={monoStyle}>
          {label}
        </span>
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function StyledSelect({
  value,
  onChange,
  children,
}: {
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        className={`${inputBaseClass} appearance-none pr-9`}
        style={{ ...monoStyle, borderColor: LINE_SOFT, color: INK }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        style={{ color: MUTED }}
      />
    </div>
  );
}

function PolicyRow({ policy }: { policy: Policy }) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    slaTier: policy.slaTier,
    maxMonthlyMar: policy.maxMonthlyMar,
    minSyncFrequencyMin: policy.minSyncFrequencyMin,
    autoOptimize: policy.autoOptimize,
    teamOwner: policy.teamOwner,
    schemaChangeProtection: policy.schemaChangeProtection ?? false,
    customPolicy: policy.customPolicy ?? "",
  });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const dirty =
    draft.slaTier !== policy.slaTier ||
    draft.maxMonthlyMar !== policy.maxMonthlyMar ||
    draft.minSyncFrequencyMin !== policy.minSyncFrequencyMin ||
    draft.autoOptimize !== policy.autoOptimize ||
    draft.teamOwner !== policy.teamOwner ||
    draft.schemaChangeProtection !== (policy.schemaChangeProtection ?? false) ||
    draft.customPolicy !== (policy.customPolicy ?? "");

  const tier = TIER_META[draft.slaTier] || TIER_META.STANDARD;

  async function save() {
    setState("saving");
    try {
      await updatePolicy(policy.connectionId, draft);
      setState("saved");
      startTransition(() => router.refresh());
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: LINE_SOFT, background: "#FDFDFC", boxShadow: "0 1px 3px rgba(16,24,26,0.05)" }}
    >
      <div
        className="flex items-start justify-between gap-3 border-b px-4 py-3.5"
        style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.015)" }}
      >
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold" style={{ color: INK }}>
            {policy.connectionId}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em]" style={{ ...monoStyle, color: MUTED }}>
            Governance contract
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state === "saved" ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ ...monoStyle, background: "rgba(11,138,92,0.10)", color: SIGNAL }}
            >
              <Check size={11} />
              Saved
            </span>
          ) : null}
          {state === "error" ? (
            <span
              className="rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ ...monoStyle, background: "rgba(192,58,43,0.10)", color: RED }}
            >
              Save failed
            </span>
          ) : null}
          <span
            className="rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ ...monoStyle, background: tier.bg, color: tier.color }}
          >
            {tier.label}
          </span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <FieldShell label="SLA tier" icon={<ShieldAlert size={12} />}>
          <div
            className="grid grid-cols-3 gap-1 rounded-lg border p-1"
            style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.02)" }}
          >
            {SLA_TIERS.map((value) => {
              const active = draft.slaTier === value;
              const meta = TIER_META[value];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDraft({ ...draft, slaTier: value })}
                  className="rounded-md px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] transition"
                  style={{
                    ...monoStyle,
                    background: active ? meta.bg : "transparent",
                    color: active ? meta.color : MUTED,
                    boxShadow: active ? `inset 0 0 0 1px ${meta.color}` : "none",
                  }}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </FieldShell>

        <FieldShell label="MAR budget (monthly active rows)">
          <div className="relative">
            <input
              type="number"
              min={0}
              className={`${inputBaseClass} pr-14`}
              style={{ ...monoStyle, borderColor: LINE_SOFT, color: INK }}
              value={draft.maxMonthlyMar}
              onChange={(event) => setDraft({ ...draft, maxMonthlyMar: Number(event.target.value) })}
            />
            <span
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ ...monoStyle, color: MUTED }}
            >
              MAR
            </span>
          </div>
        </FieldShell>

        <FieldShell label="Slowest allowed cadence">
          <StyledSelect
            value={draft.minSyncFrequencyMin}
            onChange={(value) => setDraft({ ...draft, minSyncFrequencyMin: Number(value) })}
          >
            {FREQUENCIES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {formatCadence(minutes)}
              </option>
            ))}
          </StyledSelect>
        </FieldShell>

        <FieldShell label="Cost owner (chargeback)" icon={<Users size={12} />}>
          <input
            type="text"
            className={inputBaseClass}
            style={{ ...monoStyle, borderColor: LINE_SOFT, color: INK }}
            value={draft.teamOwner}
            onChange={(event) => setDraft({ ...draft, teamOwner: event.target.value })}
          />
        </FieldShell>

        <button
          type="button"
          onClick={() => setDraft({ ...draft, autoOptimize: !draft.autoOptimize })}
          className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition"
          style={{
            borderColor: draft.autoOptimize ? "rgba(11,138,92,0.35)" : LINE_SOFT,
            background: draft.autoOptimize ? "rgba(11,138,92,0.06)" : "rgba(16,24,26,0.02)",
          }}
        >
          <span className="flex items-center gap-2">
            <Zap size={13} style={{ color: draft.autoOptimize ? SIGNAL : MUTED }} />
            <span className="text-[11.5px] font-medium" style={{ color: INK }}>
              Auto-execute low risk
            </span>
          </span>
          <span
            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition"
            style={{ background: draft.autoOptimize ? SIGNAL : "rgba(16,24,26,0.18)" }}
          >
            <span
              className="inline-block h-4 w-4 rounded-full bg-white transition"
              style={{ transform: draft.autoOptimize ? "translateX(18px)" : "translateX(2px)" }}
            />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setDraft({ ...draft, schemaChangeProtection: !draft.schemaChangeProtection })}
          className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition"
          style={{
            borderColor: draft.schemaChangeProtection ? "rgba(11,138,92,0.35)" : LINE_SOFT,
            background: draft.schemaChangeProtection ? "rgba(11,138,92,0.06)" : "rgba(16,24,26,0.02)",
          }}
        >
          <span className="flex items-center gap-2">
            <ShieldCheck size={13} style={{ color: draft.schemaChangeProtection ? SIGNAL : MUTED }} />
            <span className="min-w-0">
              <span className="block text-[11.5px] font-medium" style={{ color: INK }}>
                Schema change protection
              </span>
              <span className="block text-[10.5px]" style={{ color: MUTED }}>
                Schema events on this connector queue a human review before propagating
              </span>
            </span>
          </span>
          <span
            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition"
            style={{ background: draft.schemaChangeProtection ? SIGNAL : "rgba(16,24,26,0.18)" }}
          >
            <span
              className="inline-block h-4 w-4 rounded-full bg-white transition"
              style={{ transform: draft.schemaChangeProtection ? "translateX(18px)" : "translateX(2px)" }}
            />
          </span>
        </button>

        <FieldShell label="Custom policy (natural language)" icon={<FileText size={12} />}>
          <textarea
            rows={3}
            maxLength={2000}
            placeholder='e.g. "Never pause this connector during business hours" or "Do not block tables used by the finance dashboard"'
            className="w-full resize-y rounded-lg border bg-white px-3 py-2.5 text-[12px] leading-5 outline-none transition focus:border-[#10181A] focus:ring-2 focus:ring-[#10181A]/10"
            style={{ ...monoStyle, borderColor: LINE_SOFT, color: INK }}
            value={draft.customPolicy}
            onChange={(event) => setDraft({ ...draft, customPolicy: event.target.value })}
          />
          <p className="mt-1 text-[10.5px] leading-4" style={{ color: MUTED }}>
            The agent reads this as a guardrail when reasoning about this connector. While a custom policy exists,
            nothing auto-executes: every proposal goes through human review.
          </p>
        </FieldShell>
      </div>

      <div
        className="flex items-center justify-between gap-3 border-t px-4 py-3"
        style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.015)" }}
      >
        <span className="text-[10px] uppercase tracking-[0.14em]" style={{ ...monoStyle, color: MUTED }}>
          {dirty ? "Unsaved changes" : "Synced"}
        </span>
        <button
          type="button"
          disabled={!dirty || state === "saving"}
          onClick={() => void save()}
          className={`${CONTROL_BUTTON_CLASSNAME} disabled:opacity-40`}
          style={{ ...monoStyle, borderColor: "#10181A", background: "#10181A", color: "#F8FAF8" }}
        >
          {state === "saving" ? "Saving…" : "Save policy"}
        </button>
      </div>
    </div>
  );
}

export function PolicyEditor({ policies }: { policies: Policy[] }) {
  return (
    <div className="space-y-4">
      {policies.map((policy) => (
        <PolicyRow key={policy.connectionId} policy={policy} />
      ))}
    </div>
  );
}
