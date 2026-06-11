"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Brain,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Flag,
  Loader2,
  TerminalSquare,
  Workflow,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getTrace, type TraceStep } from "@/lib/api";
import { AMBER, CONTROL_BUTTON_CLASSNAME, INK, LINE, LINE_SOFT, MUTED, SIGNAL, monoStyle } from "./ops-ui";

const STEP_META: Record<
  string,
  { label: string; color: string; bg: string; icon: typeof Flag }
> = {
  MISSION: { label: "MISSION", color: INK, bg: "rgba(16,24,26,0.06)", icon: Flag },
  TRANSFER: { label: "HANDOFF", color: AMBER, bg: "rgba(176,120,22,0.10)", icon: ArrowLeftRight },
  TOOL_CALL: { label: "TOOL CALL", color: SIGNAL, bg: "rgba(11,138,92,0.10)", icon: Wrench },
  TOOL_RESULT: { label: "RESULT", color: MUTED, bg: "rgba(16,24,26,0.05)", icon: TerminalSquare },
  REASONING: { label: "REASONING", color: INK, bg: "rgba(16,24,26,0.06)", icon: Brain },
};

function deepParse(value: unknown): unknown {
  if (typeof value === "string") {
    const t = value.trim();
    if (
      (t.startsWith("{") && t.endsWith("}")) ||
      (t.startsWith("[") && t.endsWith("]"))
    ) {
      try {
        return deepParse(JSON.parse(t));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(deepParse);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepParse(v);
    return out;
  }
  return value;
}

function prettyJson(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    return JSON.stringify(deepParse(JSON.parse(t)), null, 2);
  } catch {
    return null;
  }
}

function softUnescape(s: string): string {
  return s
    .replace(/\\\\/g, "\u0000")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .replace(/\\r/g, "")
    .replace(/\\"/g, '"')
    .replace(/\u0000/g, "\\");
}

function StepContent({ step }: { step: TraceStep }) {
  const content = step.content || "";
  if (!content.trim()) return null;

  const formatted = prettyJson(content);
  const hasEscapes = /\\[ntr"\\]/.test(content);
  const textContent = formatted ?? (hasEscapes ? softUnescape(content) : content);

  // Only structured JSON payloads (tool calls/results) stay monospace.
  // Narrative steps (reasoning, mission, handoffs) render as markdown even when
  // the stored content carries escaped newlines.
  if (formatted !== null) {
    return (
      <div className="mt-2">
        <pre
          className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border px-3 py-2.5 text-[10.5px] leading-[1.5]"
          style={{ ...monoStyle, borderColor: LINE_SOFT, background: "rgba(16,24,26,0.03)", color: MUTED }}
        >
          {textContent}
        </pre>
      </div>
    );
  }

  const markdownSource = textContent.replace(/\$\\rightarrow\$/g, "→");

  return (
    <div className="mt-2 rounded-lg border px-3 py-2.5" style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.02)" }}>
      <div className="trace-markdown text-[12.5px] leading-5" style={{ color: MUTED }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
            ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            table: ({ children }) => (
              <div
                className="my-2 overflow-x-auto rounded-lg border"
                style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.03)" }}
              >
                <table className="min-w-full border-separate border-spacing-0 text-left text-[11px] leading-5">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead style={{ background: "rgba(16,24,26,0.04)", color: INK }}>
                {children}
              </thead>
            ),
            tbody: ({ children }) => <tbody>{children}</tbody>,
            tr: ({ children }) => <tr>{children}</tr>,
            th: ({ children }) => (
              <th
                className="border-b px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ ...monoStyle, borderColor: LINE_SOFT, color: INK }}
              >
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td
                className="border-b px-3 py-2 align-top last:border-b-0"
                style={{ borderColor: LINE_SOFT, color: MUTED }}
              >
                <div className="min-w-[120px] whitespace-pre-wrap break-words">{children}</div>
              </td>
            ),
            code: ({ children, className }) => {
              const isBlock = Boolean(className);
              if (isBlock) {
                return (
                  <code
                    className="block overflow-x-auto whitespace-pre rounded-md border px-2.5 py-2 text-[10.5px]"
                    style={{ ...monoStyle, borderColor: LINE_SOFT, background: "rgba(16,24,26,0.04)", color: INK }}
                  >
                    {children}
                  </code>
                );
              }
              return (
                <code
                  className="rounded px-1 py-0.5 text-[11px]"
                  style={{ ...monoStyle, background: "rgba(16,24,26,0.06)", color: INK }}
                >
                  {children}
                </code>
              );
            },
            pre: ({ children }) => <>{children}</>,
            strong: ({ children }) => <strong style={{ color: INK }}>{children}</strong>,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer" style={{ color: SIGNAL, textDecoration: "underline" }}>
                {children}
              </a>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 pl-3 italic" style={{ borderColor: LINE, color: MUTED }}>
                {children}
              </blockquote>
            ),
          }}
        >
          {markdownSource}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export function AgentTrace({ runId, initiallyOpen = false }: { runId: string; initiallyOpen?: boolean }) {
  const [steps, setSteps] = useState<TraceStep[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "open" | "error">(initiallyOpen ? "loading" : "idle");
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!initiallyOpen || steps || state === "error") {
      return;
    }

    let cancelled = false;

    async function loadInitialTrace() {
      try {
        const result = await getTrace(runId);
        if (cancelled) {
          return;
        }

        setSteps(result.steps);
        setOpenSteps(result.steps.length ? new Set([result.steps[0].seq]) : new Set());
        setState("open");
      } catch {
        if (!cancelled) {
          setState("error");
        }
      }
    }

    void loadInitialTrace();

    return () => {
      cancelled = true;
    };
  }, [initiallyOpen, runId, state, steps]);

  async function toggle() {
    if (state === "open") {
      setState("idle");
      return;
    }
    if (steps) {
      setState("open");
      return;
    }
    setState("loading");
    try {
      const result = await getTrace(runId);
      setSteps(result.steps);
      setOpenSteps(result.steps.length ? new Set([result.steps[0].seq]) : new Set());
      setState("open");
    } catch {
      setState("error");
    }
  }

  function toggleStep(seq: number) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  const allOpen = steps ? openSteps.size >= steps.filter((s) => (s.content || "").trim()).length && openSteps.size > 0 : false;

  function toggleAll() {
    if (!steps) return;
    if (allOpen) {
      setOpenSteps(new Set());
    } else {
      setOpenSteps(new Set(steps.filter((s) => (s.content || "").trim()).map((s) => s.seq)));
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void toggle()}
        className={CONTROL_BUTTON_CLASSNAME}
        style={{ ...monoStyle, borderColor: LINE, color: INK }}
      >
        {state === "loading" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Workflow size={13} />
        )}
        {state === "loading"
          ? "Loading trace…"
          : state === "open"
            ? "Hide agent trace"
            : state === "error"
              ? "Trace unavailable — retry"
              : "View agent trace"}
        {state !== "loading" ? (
          <ChevronDown
            size={13}
            className="transition-transform"
            style={{ transform: state === "open" ? "rotate(180deg)" : "none" }}
          />
        ) : null}
      </button>

      {state === "open" && steps ? (
        steps.length === 0 ? (
          <p className="mt-2 text-[11px]" style={{ ...monoStyle, color: MUTED }}>
            No trace steps were recorded for this run.
          </p>
        ) : (
          <div
            className="mt-3 rounded-lg border px-3.5 pb-3.5 pt-3"
            style={{ borderColor: LINE_SOFT, background: "rgba(16,24,26,0.015)" }}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em]" style={{ ...monoStyle, color: MUTED }}>
                <Workflow size={12} style={{ color: SIGNAL }} />
                {steps.length} steps · multi-agent run · Fivetran MCP + Conductor tools
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-[0.1em] transition hover:opacity-70"
                  style={{ ...monoStyle, color: SIGNAL }}
                >
                  {allOpen ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
                  {allOpen ? "Collapse all" : "Expand all"}
                </button>
              </div>
            </div>
            <ol className="relative space-y-0">
              {steps.map((step, index) => (
                <TraceStepItem
                  key={`${step.runId}-${step.seq}`}
                  step={step}
                  isLast={index === steps.length - 1}
                  open={openSteps.has(step.seq)}
                  onToggle={() => toggleStep(step.seq)}
                />
              ))}
            </ol>
          </div>
        )
      ) : null}
    </div>
  );
}

function TraceStepItem({
  step,
  isLast,
  open,
  onToggle,
}: {
  step: TraceStep;
  isLast: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = STEP_META[step.stepType] || {
    label: step.stepType,
    color: MUTED,
    bg: "rgba(16,24,26,0.05)",
    icon: TerminalSquare,
  };
  const Icon = meta.icon;
  const hasContent = Boolean((step.content || "").trim());

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast ? (
        <span className="absolute left-[13px] top-7 bottom-0 w-px" style={{ background: LINE_SOFT }} />
      ) : null}
      <span
        className="relative z-10 mt-0.5 flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: meta.bg, color: meta.color }}
      >
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => hasContent && onToggle()}
          className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left ${hasContent ? "cursor-pointer" : "cursor-default"}`}
        >
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em]"
            style={{ ...monoStyle, background: meta.bg, color: meta.color }}
          >
            #{step.seq} {meta.label}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ ...monoStyle, color: INK }}>
            {step.subAgent || "conductor"}
          </span>
          {step.toolName ? (
            <span className="text-[10px] tracking-[0.04em]" style={{ ...monoStyle, color: SIGNAL }}>
              {step.toolName}
            </span>
          ) : null}
          {hasContent ? (
            <ChevronDown
              size={12}
              className="ml-auto transition-transform"
              style={{ color: MUTED, transform: open ? "rotate(180deg)" : "none" }}
            />
          ) : null}
        </button>
        {open ? <StepContent step={step} /> : null}
      </div>
    </li>
  );
}
