"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { CONTROL_BUTTON_CLASSNAME, monoStyle } from "./ops-ui";

export function TriggerSyncButton({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");

  async function triggerSync() {
    setState("running");
    try {
      const response = await fetch(`/api/ops/trigger-sync/${encodeURIComponent(connectionId)}`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setState("done");
      startTransition(() => router.refresh());
      setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  const label =
    state === "running"
      ? "Requesting…"
      : state === "done"
        ? "Sync requested"
        : state === "error"
          ? "Request failed"
          : "Sync now";

  const icon =
    state === "running" ? (
      <RefreshCw size={13} className="animate-spin" />
    ) : state === "done" ? (
      <Check size={13} />
    ) : state === "error" ? (
      <AlertTriangle size={13} />
    ) : (
      <RefreshCw size={13} />
    );

  return (
    <button
      type="button"
      disabled={state === "running"}
      onClick={() => void triggerSync()}
      className={`${CONTROL_BUTTON_CLASSNAME} cursor-pointer appearance-none disabled:opacity-60`}
      style={{
        ...monoStyle,
        borderColor: "#10181A",
        background: state === "error" ? "#C03A2B" : "#10181A",
        color: "#F8FAF8",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
