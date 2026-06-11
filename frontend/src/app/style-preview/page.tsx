import { Archivo, IBM_Plex_Mono } from "next/font/google";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  axes: ["wdth"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

const INK = "#10181A";
const PAPER = "#EDF0EE";
const CARD = "#F8FAF8";
const LINE = "rgba(16, 24, 26, 0.18)";
const LINE_SOFT = "rgba(16, 24, 26, 0.09)";
const MUTED = "#5C6B68";
const SIGNAL = "#0B8A5C";
const SIGNAL_DIM = "rgba(11, 138, 92, 0.1)";
const AMBER = "#B07816";
const RED = "#C03A2B";
const GRID = "rgba(16, 24, 26, 0.045)";

const mono = { fontFamily: "var(--font-plex-mono), monospace" };
const display = {
  fontFamily: "var(--font-archivo), sans-serif",
  fontVariationSettings: '"wdth" 125',
};

function Crosshair({ className }: { className: string }) {
  return (
    <span className={`pointer-events-none absolute text-[10px] leading-none ${className}`} style={{ ...mono, color: "rgba(16,24,26,0.35)" }}>
      +
    </span>
  );
}

function Panel({
  children,
  tag,
  className = "",
}: {
  children: React.ReactNode;
  tag?: string;
  className?: string;
}) {
  return (
    <div className={`relative border ${className}`} style={{ borderColor: LINE, background: CARD }}>
      <Crosshair className="-left-[3px] -top-[5px]" />
      <Crosshair className="-right-[3px] -top-[5px]" />
      <Crosshair className="-left-[3px] -bottom-[5px]" />
      <Crosshair className="-right-[3px] -bottom-[5px]" />
      {tag ? (
        <span
          className="absolute -top-[9px] left-4 px-1.5 text-[10px] font-medium uppercase tracking-[0.2em]"
          style={{ ...mono, color: MUTED, background: CARD }}
        >
          {tag}
        </span>
      ) : null}
      {children}
    </div>
  );
}

function Readout({ label, value, note, noteColor = MUTED }: { label: string; value: string; note?: string; noteColor?: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.22em]" style={{ ...mono, color: MUTED }}>
        {label}
      </p>
      <p className="mt-2 text-4xl font-semibold tracking-tight" style={{ ...mono }}>
        {value}
      </p>
      {note ? (
        <p className="mt-1.5 text-[12px]" style={{ ...mono, color: noteColor }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

export default function StylePreview() {
  return (
    <main
      className={`${archivo.variable} ${plexMono.variable} min-h-screen`}
      style={{
        background: `
          linear-gradient(${GRID} 1px, transparent 1px),
          linear-gradient(90deg, ${GRID} 1px, transparent 1px),
          ${PAPER}`,
        backgroundSize: "24px 24px, 24px 24px, 100% 100%",
        color: INK,
        fontFamily: "var(--font-archivo), sans-serif",
      }}
    >
      <header className="border-b" style={{ borderColor: LINE, background: CARD }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-6 w-6 items-center justify-center text-[13px] font-bold text-white"
              style={{ background: INK }}
            >
              ▸
            </span>
            <span className="text-[15px] font-bold uppercase tracking-[0.18em]" style={display}>
              Conductor
            </span>
            <span className="text-[11px]" style={{ ...mono, color: MUTED }}>
              v0.1 · ops console
            </span>
          </div>
          <div className="flex items-center gap-5 text-[11px]" style={mono}>
            <span className="inline-flex items-center gap-1.5" style={{ color: SIGNAL }}>
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full animate-ping rounded-full opacity-60" style={{ background: SIGNAL }} />
                <span className="relative h-2 w-2 rounded-full" style={{ background: SIGNAL }} />
              </span>
              AGENT ACTIVE
            </span>
            <span style={{ color: MUTED }}>SSE CONNECTED</span>
            <span style={{ color: MUTED }}>UTC 14:32:07</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 pb-24">
        <section className="grid gap-10 border-b py-14 lg:grid-cols-[1.2fr_0.8fr]" style={{ borderColor: LINE }}>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.25em]" style={{ ...mono, color: SIGNAL }}>
              ● Style proposal 04 — &quot;ops console&quot;
            </p>
            <h1
              className="mt-5 text-[clamp(2.4rem,5vw,3.9rem)] font-bold uppercase leading-[1.02] tracking-tight"
              style={display}
            >
              An agent on duty,
              <br />
              <span style={{ color: SIGNAL }}>24/7,</span> watching
              <br />
              your pipelines.
            </h1>
            <p className="mt-6 max-w-lg text-[16px] leading-7" style={{ color: MUTED }}>
              Conductor is not a report — it is an operator. It reads Fivetran telemetry, detects
              wasted spend, drafts the fix, and waits for your go. This interface is its
              instrument panel.
            </p>
            <div className="mt-8 flex gap-3">
              <button
                className="px-5 py-2.5 text-[13px] font-bold uppercase tracking-[0.14em] text-white transition hover:opacity-90"
                style={{ background: INK, ...mono }}
                type="button"
              >
                Open console
              </button>
              <button
                className="border px-5 py-2.5 text-[13px] font-bold uppercase tracking-[0.14em] transition hover:bg-black/5"
                style={{ borderColor: LINE, ...mono }}
                type="button"
              >
                Event log
              </button>
            </div>
          </div>

          <Panel tag="live event feed" className="p-5">
            <div className="space-y-3 pt-2 text-[12px] leading-5" style={mono}>
              {[
                { t: "14:31:52", msg: "sync_end · salesforce_prod · 1.24M MAR", c: AMBER },
                { t: "14:31:53", msg: "agent: budget exceeded +24% — analyzing", c: SIGNAL },
                { t: "14:31:58", msg: "agent: 2 cold tables found, $640/mo recoverable", c: SIGNAL },
                { t: "14:31:59", msg: "approval_request created → waiting for human", c: INK },
                { t: "14:32:04", msg: "sync_start · stripe_payments", c: MUTED },
              ].map((row) => (
                <div key={row.t + row.msg} className="flex gap-3">
                  <span style={{ color: MUTED }}>{row.t}</span>
                  <span style={{ color: row.c }}>{row.msg}</span>
                </div>
              ))}
              <div className="flex gap-3">
                <span style={{ color: MUTED }}>14:32:07</span>
                <span style={{ color: SIGNAL }}>
                  ▍<span className="animate-pulse">listening…</span>
                </span>
              </div>
            </div>
          </Panel>
        </section>

        <section className="grid gap-px border-b py-10 sm:grid-cols-4" style={{ borderColor: LINE }}>
          <Readout label="Monthly spend" value="$12,480" note="+4.2% vs May" noteColor={AMBER} />
          <Readout label="Waste detected" value="$4,830" note="38.7% of spend" noteColor={SIGNAL} />
          <Readout label="Connectors" value="12" note="3 flagged" noteColor={MUTED} />
          <Readout label="Approvals" value="02" note="oldest 41 min" noteColor={MUTED} />
        </section>

        <section className="grid gap-10 border-b py-12 lg:grid-cols-2" style={{ borderColor: LINE }}>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.25em]" style={{ ...mono, color: SIGNAL }}>
              Typography
            </p>
            <div className="mt-6 space-y-5">
              <div className="border-b pb-5" style={{ borderColor: LINE_SOFT }}>
                <p className="text-3xl font-bold uppercase tracking-tight" style={display}>
                  Archivo Expanded
                </p>
                <p className="mt-1 text-sm" style={{ color: MUTED }}>
                  Display — wide, engineered, all-caps headers. Reads like equipment labeling, not a
                  landing page.
                </p>
              </div>
              <div className="border-b pb-5" style={{ borderColor: LINE_SOFT }}>
                <p className="text-3xl tracking-tight">Archivo (normal width)</p>
                <p className="mt-1 text-sm" style={{ color: MUTED }}>
                  Interface — same family, narrow cut. One variable font, two voices. Not Inter.
                </p>
              </div>
              <div>
                <p className="text-3xl tracking-tight" style={mono}>
                  IBM Plex Mono
                </p>
                <p className="mt-1 text-sm" style={{ color: MUTED }}>
                  Telemetry — every number, timestamp, ID and log line. The agent speaks in mono.
                </p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.25em]" style={{ ...mono, color: SIGNAL }}>
              Palette — instrument neutral + signal green
            </p>
            <div className="mt-6 overflow-hidden border" style={{ borderColor: LINE }}>
              {[
                { name: "TECH GRAY", hex: PAPER, usage: "Background + blueprint grid", text: INK },
                { name: "PANEL", hex: CARD, usage: "Surfaces", text: INK },
                { name: "GRAPHITE", hex: INK, usage: "Text, primary buttons", text: PAPER },
                { name: "SIGNAL", hex: SIGNAL, usage: "Agent activity, savings, GO states", text: "#fff" },
                { name: "AMBER", hex: AMBER, usage: "Drift, over budget, delays", text: "#fff" },
                { name: "RED", hex: RED, usage: "Failures only", text: "#fff" },
              ].map((swatch) => (
                <div
                  key={swatch.name}
                  className="flex items-center justify-between px-4 py-3 text-[12px]"
                  style={{ background: swatch.hex, color: swatch.text, ...mono }}
                >
                  <span className="font-semibold">{swatch.name}</span>
                  <span className="opacity-75">{swatch.usage}</span>
                  <span>{swatch.hex}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm leading-6" style={{ color: MUTED }}>
              The grid is the brand: every screen sits on engineering graph paper. Green is never
              decoration — it means the agent did something.
            </p>
          </div>
        </section>

        <section className="py-12">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em]" style={{ ...mono, color: SIGNAL }}>
            Components
          </p>

          <div className="mt-8 grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <Panel tag="connector · salesforce_prod" className="p-6">
              <div className="flex items-start justify-between pt-2">
                <div>
                  <h3 className="text-2xl font-bold uppercase tracking-tight" style={display}>
                    salesforce_prod
                  </h3>
                  <p className="mt-1 text-[12px]" style={{ ...mono, color: MUTED }}>
                    type=salesforce · cadence=60m · sla=STANDARD
                  </p>
                </div>
                <span
                  className="border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
                  style={{ ...mono, borderColor: AMBER, color: AMBER, background: "rgba(176,120,22,0.08)" }}
                >
                  ▲ over budget
                </span>
              </div>

              <div className="mt-7 flex items-baseline gap-3">
                <span className="text-6xl font-semibold tracking-tight" style={mono}>
                  1.24M
                </span>
                <span className="text-[13px]" style={{ ...mono, color: MUTED }}>
                  / 1.00M MAR · <span style={{ color: AMBER }}>+24%</span>
                </span>
              </div>

              <div className="mt-5">
                <div className="flex h-3 w-full overflow-hidden border" style={{ borderColor: LINE }}>
                  <div className="h-full" style={{ width: "62%", background: INK }} />
                  <div className="h-full" style={{ width: "19%", background: AMBER }} />
                  <div
                    className="h-full flex-1"
                    style={{
                      background: `repeating-linear-gradient(-45deg, transparent, transparent 3px, ${LINE} 3px, ${LINE} 4px)`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-[0.15em]" style={{ ...mono, color: MUTED }}>
                  <span>0</span>
                  <span style={{ color: AMBER }}>budget 1.00M</span>
                  <span>cap 1.60M</span>
                </div>
              </div>

              <table className="mt-7 w-full text-[13px]">
                <tbody style={mono}>
                  {[
                    ["last_sync", "12m ago", INK],
                    ["value_ratio", "0.84", INK],
                    ["est_monthly_cost", "$1,920", INK],
                    ["recoverable_waste", "$640/mo", SIGNAL],
                  ].map(([k, v, c]) => (
                    <tr key={k as string} className="border-t" style={{ borderColor: LINE_SOFT }}>
                      <td className="py-2.5" style={{ color: MUTED }}>
                        {k}
                      </td>
                      <td className="py-2.5 text-right font-medium" style={{ color: c as string }}>
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <div className="flex flex-col gap-8">
              <Panel tag="approval · APR-0042" className="p-6">
                <p className="pt-2 text-[15px] leading-7">
                  Agent proposes pausing <span style={mono}>2 cold tables</span> on{" "}
                  <span style={mono}>salesforce_prod</span> — est.{" "}
                  <strong style={{ color: SIGNAL }}>$640/mo saved</strong>, zero downstream
                  consumers. Human sign-off required.
                </p>
                <div className="mt-5 flex gap-2.5">
                  <button
                    className="px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white transition hover:opacity-90"
                    style={{ background: SIGNAL, ...mono }}
                    type="button"
                  >
                    Approve ▸
                  </button>
                  <button
                    className="border px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] transition hover:bg-black/5"
                    style={{ borderColor: LINE, ...mono }}
                    type="button"
                  >
                    Reject
                  </button>
                  <button
                    className="ml-auto px-2 py-2 text-[12px] font-bold uppercase tracking-[0.12em]"
                    style={{ color: MUTED, ...mono }}
                    type="button"
                  >
                    reasoning →
                  </button>
                </div>
              </Panel>

              <Panel tag="connector states" className="p-6">
                <div className="flex flex-wrap gap-2 pt-2">
                  {[
                    { label: "● healthy", color: SIGNAL, bg: SIGNAL_DIM },
                    { label: "▲ over budget", color: AMBER, bg: "rgba(176,120,22,0.08)" },
                    { label: "◔ delayed", color: AMBER, bg: "rgba(176,120,22,0.08)" },
                    { label: "✕ failure", color: RED, bg: "rgba(192,58,43,0.08)" },
                    { label: "‖ paused", color: MUTED, bg: "rgba(16,24,26,0.05)" },
                  ].map((status) => (
                    <span
                      key={status.label}
                      className="border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em]"
                      style={{ ...mono, color: status.color, borderColor: LINE, background: status.bg }}
                    >
                      {status.label}
                    </span>
                  ))}
                </div>
              </Panel>

              <div className="relative border p-6" style={{ borderColor: INK, background: INK, color: PAPER }}>
                <p className="text-[15px] font-bold uppercase leading-6 tracking-wide" style={display}>
                  Green means the agent acted.
                  <br />
                  Everything else stays quiet.
                </p>
                <p className="mt-3 text-[11px] uppercase tracking-[0.2em]" style={{ ...mono, color: "rgba(237,240,238,0.55)" }}>
                  conductor design principle № 1
                </p>
              </div>
            </div>
          </div>
        </section>

        <p className="border-t pt-7 text-sm" style={{ borderColor: LINE, color: MUTED }}>
          If approved: blueprint grid background, crosshair panels with tags, mono telemetry, square
          corners, Archivo Expanded headers, and signal green strictly reserved for agent activity.
        </p>
      </div>
    </main>
  );
}
