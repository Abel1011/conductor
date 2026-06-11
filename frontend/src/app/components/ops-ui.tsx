import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

const INK = "#10181A";
const CARD = "#F8FAF8";
const LINE = "rgba(16, 24, 26, 0.18)";
const LINE_SOFT = "rgba(16, 24, 26, 0.08)";
const MUTED = "#5C6B68";
const SIGNAL = "#0B8A5C";
const SIGNAL_DIM = "rgba(11, 138, 92, 0.10)";
const AMBER = "#B07816";
const AMBER_DIM = "rgba(176, 120, 22, 0.10)";
const RED = "#C03A2B";
const RED_DIM = "rgba(192, 58, 43, 0.10)";

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-plex-mono), monospace",
};

const CONTROL_BUTTON_CLASSNAME =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3.5 text-[10.5px] font-bold leading-none uppercase tracking-[0.12em] transition hover:opacity-85";

const wideStyle: CSSProperties = {
  fontFamily: "var(--font-archivo), sans-serif",
  fontVariationSettings: '"wdth" 125',
};

const STATUS: Record<string, { color: string; bg: string; symbol: string; label: string }> = {
  HEALTHY: { color: SIGNAL, bg: SIGNAL_DIM, symbol: "●", label: "Healthy" },
  OVER_BUDGET: { color: AMBER, bg: AMBER_DIM, symbol: "▲", label: "Over budget" },
  DELAYED: { color: AMBER, bg: AMBER_DIM, symbol: "◔", label: "Delayed" },
  FAILURE: { color: RED, bg: RED_DIM, symbol: "✕", label: "Failure" },
  PAUSED: { color: MUTED, bg: "rgba(16,24,26,0.05)", symbol: "‖", label: "Paused" },
  HAS_COLD_TABLES: { color: AMBER, bg: AMBER_DIM, symbol: "△", label: "Cold tables" },
  PENDING_SETUP: { color: MUTED, bg: "rgba(16,24,26,0.05)", symbol: "○", label: "Pending setup" },
};

const RISKS: Record<string, { color: string; bg: string }> = {
  LOW: { color: SIGNAL, bg: SIGNAL_DIM },
  MEDIUM: { color: AMBER, bg: AMBER_DIM },
  HIGH: { color: RED, bg: RED_DIM },
};

export { AMBER, CARD, CONTROL_BUTTON_CLASSNAME, INK, LINE, LINE_SOFT, MUTED, RED, SIGNAL, monoStyle, wideStyle };

export function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const raw =
    typeof value === "object" && value !== null && "value" in value
      ? (value as { value: unknown }).value
      : value;

  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelative(iso: unknown) {
  const date = toDate(iso);
  if (!date) {
    return "—";
  }

  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.round(hours / 24)}d ago`;
}

export function formatDateTime(iso: unknown) {
  const date = toDate(iso);
  if (!date) {
    return "—";
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-medium uppercase tracking-[0.18em]" style={{ ...monoStyle, color: SIGNAL }}>
            ● {eyebrow}
          </p>
          <h1 className="mt-1.5 text-[20px] font-bold uppercase leading-none tracking-tight" style={wideStyle}>
            {title}
          </h1>
          <p className="mt-2.5 max-w-2xl text-[12.5px] leading-5" style={{ color: MUTED }}>
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function PageButton({ href, children, inverse = false }: { href: string; children: ReactNode; inverse?: boolean }) {
  return (
    <Link
      href={href}
      className={CONTROL_BUTTON_CLASSNAME}
      style={{
        ...monoStyle,
        borderColor: inverse ? INK : LINE,
        background: inverse ? INK : "#FFFFFF",
        color: inverse ? CARD : INK,
      }}
    >
      {children}
    </Link>
  );
}

export function StatGrid({
  items,
}: {
  items: Array<{ label: string; value: string; note?: string; noteColor?: string; icon?: ReactNode }>;
}) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border px-3.5 py-3"
          style={{ borderColor: LINE_SOFT, background: CARD, boxShadow: "0 1px 2px rgba(16,24,26,0.04)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[9.5px] font-medium uppercase tracking-[0.18em]" style={{ ...monoStyle, color: MUTED }}>
              {item.label}
            </p>
            {item.icon ? <span className="flex-shrink-0" style={{ color: MUTED }}>{item.icon}</span> : null}
          </div>
          <p className="mt-2 text-[22px] font-semibold leading-none tracking-tight" style={monoStyle}>
            {item.value}
          </p>
          {item.note ? (
            <p className="mt-1.5 truncate text-[10.5px]" style={{ ...monoStyle, color: item.noteColor || MUTED }}>
              {item.note}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function Panel({
  title,
  eyebrow,
  icon,
  children,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border ${className}`.trim()}
      style={{ borderColor: LINE_SOFT, background: CARD, boxShadow: "0 1px 2px rgba(16,24,26,0.05)" }}
    >
      <div className="flex min-w-0 flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3" style={{ borderColor: LINE_SOFT }}>
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="flex-shrink-0" style={{ color: SIGNAL }}>{icon}</span> : null}
          <h2 className="truncate text-[15px] font-bold uppercase tracking-tight" style={wideStyle}>
            {title}
          </h2>
        </div>
        {eyebrow ? (
          <p
            className="min-w-0 max-w-full break-words text-[10px] font-medium uppercase tracking-[0.16em] sm:text-right"
            style={{ ...monoStyle, color: MUTED, overflowWrap: "anywhere" }}
          >
            {eyebrow}
          </p>
        ) : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function BudgetBar({ current, budget, pct }: { current: number; budget: number; pct: number }) {
  const overBudget = pct > 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px]" style={{ ...monoStyle, color: MUTED }}>
        <span>{formatCompact(current)} MAR</span>
        <span>/ {formatCompact(budget)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(16,24,26,0.08)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(pct, 100)}%`,
            background: overBudget ? RED : pct > 80 ? AMBER : SIGNAL,
          }}
        />
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const item = STATUS[status] || {
    color: MUTED,
    bg: "rgba(16,24,26,0.05)",
    symbol: "○",
    label: status.replaceAll("_", " "),
  };

  return (
    <span
      className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{ ...monoStyle, color: item.color, background: item.bg }}
    >
      {item.symbol} {item.label}
    </span>
  );
}

export function RiskBadge({ riskLevel }: { riskLevel: string }) {
  const item = RISKS[riskLevel] || RISKS.LOW;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{ ...monoStyle, color: item.color, background: item.bg }}
    >
      {riskLevel} risk
    </span>
  );
}

export function EmptyState({
  title,
  description,
  href,
  actionLabel,
}: {
  title: string;
  description: string;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed px-5 py-8 text-center" style={{ borderColor: LINE }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ ...monoStyle, color: SIGNAL }}>
        ● {title}
      </p>
      <p className="mx-auto mt-2.5 max-w-xl text-[12.5px] leading-5" style={{ color: MUTED }}>
        {description}
      </p>
      {href && actionLabel ? (
        <div className="mt-4">
          <PageButton href={href}>{actionLabel}</PageButton>
        </div>
      ) : null}
    </div>
  );
}

export function BackendErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div>
      <Panel title={title} eyebrow="Backend status">
        <p className="text-[13px] leading-6" style={{ ...monoStyle, color: MUTED }}>
          {message}
        </p>
      </Panel>
    </div>
  );
}