"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronUp } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

const monoStyle = { fontFamily: "var(--font-plex-mono), monospace" } as const;

type LiveStep = {
  id: string;
  agent: string;
  message: string;
};

const AGENT_COLORS: Record<string, string> = {
  conductor: "#0B8A5C",
  cost_agent: "#B07D10",
  perf_agent: "#C03A2B",
  chargeback_agent: "#3B6FB5",
};

/**
 * Floating panel that streams agent mission steps in real time via SSE while
 * an ADK mission is running. Appears on mission start, collapses on complete.
 */
export function LiveMissionFeed() {
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const source = new EventSource(`${API_BASE_URL}/api/events`);

    const onStarted = () => {
      setSteps([]);
      setRunning(true);
      setCollapsed(false);
    };

    const onStep = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (!data?.message) return;
        setRunning(true);
        setSteps((prev) => [
          ...prev.slice(-119),
          { id: data.id || `${Date.now()}-${prev.length}`, agent: data.agent || "agent", message: data.message },
        ]);
      } catch {
        // ignore malformed payloads
      }
    };

    const onComplete = () => {
      setRunning(false);
      setTimeout(() => {
        setSteps([]);
      }, 8000);
    };

    source.addEventListener("agent_mission_started", onStarted);
    source.addEventListener("agent_mission_step", onStep);
    source.addEventListener("agent_mission_complete", onComplete);

    return () => {
      source.close();
    };
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [steps]);

  if (steps.length === 0 && !running) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[90] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl"
      style={{ background: "#0E1412", borderColor: "rgba(11,138,92,0.45)" }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left"
        style={monoStyle}
      >
        <Bot size={14} style={{ color: "#0B8A5C" }} className={running ? "animate-pulse" : ""} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: "#EDF0EE" }}>
          {running ? "Agents working — live trace" : "Mission complete"}
        </span>
        <span className="text-[10px]" style={{ color: "rgba(237,240,238,0.45)" }}>
          {steps.length} step(s)
        </span>
        <span className="ml-auto" style={{ color: "rgba(237,240,238,0.55)" }}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {!collapsed && (
        <div ref={listRef} className="max-h-56 space-y-1 overflow-y-auto px-4 pb-3">
          {steps.map((step) => (
            <div key={step.id} className="flex gap-2 text-[11px] leading-relaxed" style={monoStyle}>
              <span
                className="flex-shrink-0 font-semibold"
                style={{ color: AGENT_COLORS[step.agent] || "#7BA88F" }}
              >
                [{step.agent}]
              </span>
              <span style={{ color: "rgba(237,240,238,0.78)" }}>{step.message}</span>
            </div>
          ))}
          {running && (
            <div className="flex gap-2 text-[11px]" style={monoStyle}>
              <span className="animate-pulse" style={{ color: "rgba(237,240,238,0.4)" }}>▋</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
