"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Play, RefreshCw } from "lucide-react";
import { CONTROL_BUTTON_CLASSNAME } from "./ops-ui";

const monoStyle = { fontFamily: "var(--font-plex-mono), monospace" } as const;

type AuditState = "idle" | "running" | "done" | "empty" | "error";

export function RunAuditButton() {
  const router = useRouter();
  const [state, setState] = useState<AuditState>("idle");
  const [created, setCreated] = useState(0);

  async function runAudit() {
    setState("running");
    try {
      const response = await fetch("/api/ops/trigger-analysis", { method: "POST" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json().catch(() => ({}))) as { created?: number };
      const newFindings = payload.created ?? 0;
      setCreated(newFindings);
      setState(newFindings > 0 ? "done" : "empty");
      startTransition(() => router.refresh());
      setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  const label =
    state === "running"
      ? "Auditing…"
      : state === "done"
        ? `${created} new finding${created === 1 ? "" : "s"}`
        : state === "empty"
          ? "No new findings"
          : state === "error"
            ? "Audit failed"
            : "Run audit";

  const background =
    state === "error" ? "#C03A2B" : state === "done" ? "#0B8A5C" : "#10181A";

  const icon =
    state === "running" ? (
      <RefreshCw size={13} className="animate-spin" />
    ) : state === "done" || state === "empty" ? (
      <Check size={13} />
    ) : state === "error" ? (
      <AlertTriangle size={13} />
    ) : (
      <Play size={13} />
    );

  return (
    <button
      type="button"
      disabled={state === "running"}
      onClick={() => void runAudit()}
      className={`${CONTROL_BUTTON_CLASSNAME} cursor-pointer appearance-none disabled:opacity-60`}
      style={{ ...monoStyle, borderColor: background, background, color: "#F8FAF8" }}
    >
      {icon}
      {label}
    </button>
  );
}
