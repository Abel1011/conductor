"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, RefreshCw, Sparkles } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { CONTROL_BUTTON_CLASSNAME } from "./ops-ui";

const monoStyle = { fontFamily: "var(--font-plex-mono), monospace" } as const;

type MissionState = "idle" | "starting" | "running" | "done" | "error";

/**
 * Launches the real ADK multi-agent runtime (Gemini orchestrator + Gate/Cost/Perf/
 * Chargeback specialists) against the live fleet, then follows the mission via SSE
 * until its trace is published.
 */
export function RunMissionButton() {
  const router = useRouter();
  const [state, setState] = useState<MissionState>("idle");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => sourceRef.current?.close();
  }, []);

  async function runMission() {
    setState("starting");
    try {
      const response = await fetch("/api/ops/run-mission", { method: "POST" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setState("running");

      const source = new EventSource(`${API_BASE_URL}/api/events`);
      sourceRef.current = source;
      source.addEventListener("agent_mission_complete", () => {
        source.close();
        sourceRef.current = null;
        setState("done");
        router.refresh();
        setTimeout(() => setState("idle"), 5000);
      });
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  const label =
    state === "starting"
      ? "Launching agents…"
      : state === "running"
        ? "Agents working…"
        : state === "done"
          ? "Mission complete"
          : state === "error"
            ? "Mission failed"
            : "Run AI mission";

  const background =
    state === "error" ? "#C03A2B" : state === "done" ? "#0B8A5C" : "#0B8A5C";

  const icon =
    state === "starting" || state === "running" ? (
      <RefreshCw size={13} className="animate-spin" />
    ) : state === "done" ? (
      <Check size={13} />
    ) : state === "error" ? (
      <AlertTriangle size={13} />
    ) : (
      <Sparkles size={13} />
    );

  return (
    <button
      type="button"
      disabled={state === "starting" || state === "running"}
      onClick={() => void runMission()}
      className={`${CONTROL_BUTTON_CLASSNAME} cursor-pointer appearance-none disabled:opacity-60`}
      style={{ ...monoStyle, borderColor: background, background, color: "#F8FAF8" }}
    >
      {icon}
      {label}
    </button>
  );
}
