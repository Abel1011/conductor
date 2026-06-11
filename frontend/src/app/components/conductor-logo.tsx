const SIGNAL = "#0B8A5C";
const PAPER = "#EDF0EE";
export function ConductorMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="7" fill={SIGNAL} />
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        stroke="rgba(237,240,238,0.25)"
        strokeWidth="1"
      />

      <path
        d="M6 10 H11 Q14 10 15 13 L15.5 14.5"
        stroke={PAPER}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path d="M6 16 H13" stroke={PAPER} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      <path
        d="M6 22 H11 Q14 22 15 19 L15.5 17.5"
        stroke={PAPER}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />

      <circle cx="17.5" cy="16" r="3.4" fill={PAPER} />
      <circle cx="17.5" cy="16" r="1.4" fill={SIGNAL} />

      <path d="M21 16 H26" stroke={PAPER} strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M24.4 13.2 L27.2 16 L24.4 18.8"
        stroke={PAPER}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function ConductorLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <ConductorMark size={compact ? 24 : 28} />
      <span className="flex flex-col leading-none">
        <span
          className={`font-bold uppercase tracking-[0.2em] text-white ${compact ? "text-[12px]" : "text-[13px]"}`}
          style={{ fontVariationSettings: '"wdth" 125' }}
        >
          Conductor
        </span>
        {!compact ? (
          <span
            className="mt-1.5 text-[8.5px] uppercase tracking-[0.22em]"
            style={{
              fontFamily: "var(--font-plex-mono), monospace",
              color: "rgba(237,240,238,0.4)",
            }}
          >
            ops console · v0.1
          </span>
        ) : null}
      </span>
    </span>
  );
}
