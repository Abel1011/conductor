"use client";

import { useState } from "react";
import { updateWorkspaceSettings, type GovernanceMode } from "@/lib/api";

const monoStyle = { fontFamily: "var(--font-plex-mono), monospace" } as const;
const INK = "#10181A";
const MUTED = "#5C6B6A";
const LINE_SOFT = "rgba(16,24,26,0.08)";

const MODES: { value: GovernanceMode; label: string; description: string }[] = [
  {
    value: "OBSERVE",
    label: "Observe",
    description: "New connectors sync immediately. Conductor applies a default policy and queues a human review.",
  },
  {
    value: "ENFORCE",
    label: "Enforce",
    description: "New connectors are paused the moment they appear. They stay frozen until a human approves them — approval unpauses the connector.",
  },
];

export function GovernanceModeToggle({ initialMode }: { initialMode: GovernanceMode }) {
  const [mode, setMode] = useState<GovernanceMode>(initialMode);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  async function selectMode(next: GovernanceMode) {
    if (next === mode || state === "saving") return;
    const previous = mode;
    setMode(next);
    setState("saving");
    try {
      await updateWorkspaceSettings({ governanceMode: next });
      setState("idle");
    } catch {
      setMode(previous);
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((option) => {
          const active = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              disabled={state === "saving"}
              onClick={() => void selectMode(option.value)}
              className="rounded-lg border p-3.5 text-left transition disabled:opacity-60"
              style={{
                ...monoStyle,
                borderColor: active ? INK : LINE_SOFT,
                background: active ? INK : "transparent",
                color: active ? "#F8FAF8" : INK,
                boxShadow: active ? "none" : "0 1px 2px rgba(16,24,26,0.04)",
              }}
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.14em]">
                {option.label}
                {active ? " · active" : ""}
              </div>
              <div
                className="mt-1 text-[11px] leading-4"
                style={{ color: active ? "#C9D2CF" : MUTED }}
              >
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
      {state === "saving" ? (
        <p className="text-[11px]" style={{ ...monoStyle, color: MUTED }}>
          Saving…
        </p>
      ) : null}
      {state === "error" ? (
        <p className="text-[11px]" style={{ ...monoStyle, color: "#C03A2B" }}>
          Could not save governance mode. Try again.
        </p>
      ) : null}
    </div>
  );
}
