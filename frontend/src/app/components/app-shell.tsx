"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Cable,
  ClipboardCheck,
  LayoutDashboard,
  Menu,
  Rocket,
  ShieldCheck,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { ConductorLogo } from "./conductor-logo";
import { NotificationToasts } from "./notification-toasts";

const INK = "#10181A";
const SIGNAL = "#0B8A5C";

const NAV: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/connectors", label: "Connectors", icon: Cable },
  { href: "/spend", label: "Spend", icon: Wallet },
  { href: "/settings", label: "Policies", icon: ShieldCheck },
  { href: "/onboarding", label: "Setup", icon: Rocket },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="px-5 pb-5 pt-6">
        <ConductorLogo />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="mb-1 flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors duration-150"
              style={{
                fontFamily: "var(--font-plex-mono), monospace",
                color: active ? "#EDF0EE" : "rgba(237,240,238,0.48)",
                background: active ? "rgba(237,240,238,0.09)" : "transparent",
                textDecoration: "none",
              }}
            >
              <Icon size={14} strokeWidth={2} className="flex-shrink-0" style={{ color: active ? SIGNAL : "rgba(237,240,238,0.35)" }} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-3 mb-4 rounded-lg px-3.5 py-3" style={{ background: "rgba(237,240,238,0.05)" }}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
            <span className="absolute h-full w-full animate-ping rounded-full opacity-60" style={{ background: SIGNAL }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: SIGNAL }} />
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ fontFamily: "var(--font-plex-mono), monospace", color: SIGNAL }}
          >
            Agent active
          </span>
        </div>
        <p
          className="mt-1.5 text-[9px] uppercase tracking-[0.12em] leading-4"
          style={{ fontFamily: "var(--font-plex-mono), monospace", color: "rgba(237,240,238,0.32)" }}
        >
          Fivetran · SSE connected
        </p>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen overflow-hidden lg:h-dvh lg:min-h-0" style={{ fontFamily: "var(--font-archivo), sans-serif" }}>
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setOpen(false)}
        />
      )}

      <div
        className="fixed inset-y-0 left-0 z-50 flex w-[230px] flex-col transition-transform duration-200 ease-in-out lg:hidden"
        style={{
          background: INK,
          transform: open ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 rounded-lg p-1.5 transition hover:opacity-70"
          style={{ color: "rgba(237,240,238,0.5)" }}
        >
          <X size={16} />
        </button>
        <SidebarContent pathname={pathname} onNavigate={() => setOpen(false)} />
      </div>

      <aside className="hidden h-dvh w-[230px] flex-shrink-0 flex-col lg:flex" style={{ background: INK }}>
        <SidebarContent pathname={pathname} />
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex items-center gap-3 px-4 py-3 lg:hidden"
          style={{ background: INK, borderBottom: "1px solid rgba(237,240,238,0.08)" }}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg p-1.5 transition hover:opacity-70"
            style={{ color: "rgba(237,240,238,0.7)" }}
          >
            <Menu size={18} />
          </button>
          <ConductorLogo compact />
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1240px] px-4 py-5 sm:px-6 sm:py-6">
            {children}
          </div>
        </main>
      </div>

      <NotificationToasts />
    </div>
  );
}
