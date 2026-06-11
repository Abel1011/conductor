"use client";

import { useEffect, useState } from "react";
import { Bell, Mail, MessageSquare, X } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

const INK = "#10181A";
const SIGNAL = "#0B8A5C";
const MUTED = "rgba(16,24,26,0.55)";
const monoStyle = { fontFamily: "var(--font-plex-mono), monospace" };

type NotificationChannelResult = {
  channel: "slack" | "discord" | "email";
  target: string;
  delivered: boolean;
  simulated: boolean;
};

type NotificationToast = {
  id: string;
  label: string;
  message: string;
  channels: NotificationChannelResult[];
};

const CHANNEL_LABEL: Record<string, string> = {
  slack: "Slack",
  discord: "Discord",
  email: "Email",
};

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "email") return <Mail size={11} />;
  return <MessageSquare size={11} />;
}

export function NotificationToasts() {
  const [toasts, setToasts] = useState<NotificationToast[]>([]);

  useEffect(() => {
    const source = new EventSource(`${API_BASE_URL}/api/events`);

    const onNotification = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const toast: NotificationToast = {
          id: data.id || String(Date.now()),
          label: data.label || "Notification",
          message: String(data.message || "").replace(/^\[Conductor\]\s*/, ""),
          channels: Array.isArray(data.channels) ? data.channels : [],
        };
        setToasts((current) => [...current.slice(-3), toast]);
        setTimeout(() => {
          setToasts((current) => current.filter((item) => item.id !== toast.id));
        }, 7000);
      } catch {
      }
    };

    source.addEventListener("notification_sent", onNotification);
    return () => {
      source.removeEventListener("notification_sent", onNotification);
      source.close();
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto rounded-xl border bg-white px-4 py-3 shadow-lg"
          style={{ borderColor: "rgba(16,24,26,0.12)", boxShadow: "0 8px 24px rgba(16,24,26,0.14)" }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{ background: "rgba(11,138,92,0.10)", color: SIGNAL }}
              >
                <Bell size={12} />
              </span>
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ ...monoStyle, color: SIGNAL }}
              >
                {toast.label}
              </span>
            </div>
            <button
              type="button"
              className="rounded p-0.5 transition hover:opacity-60"
              style={{ color: MUTED }}
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            >
              <X size={13} />
            </button>
          </div>
          <p className="mt-1.5 text-[12px] leading-5" style={{ color: INK }}>
            {toast.message}
          </p>
          {toast.channels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {toast.channels.map((entry) => (
                <span
                  key={entry.channel}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                  style={{
                    ...monoStyle,
                    borderColor: entry.delivered ? "rgba(11,138,92,0.30)" : "rgba(16,24,26,0.12)",
                    color: entry.delivered ? SIGNAL : MUTED,
                    background: entry.delivered ? "rgba(11,138,92,0.06)" : "rgba(16,24,26,0.02)",
                  }}
                >
                  <ChannelIcon channel={entry.channel} />
                  {CHANNEL_LABEL[entry.channel] || entry.channel}
                  {entry.simulated ? " · not set" : entry.delivered ? " · sent" : " · failed"}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
