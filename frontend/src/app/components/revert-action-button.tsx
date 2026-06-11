"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Undo2, X } from "lucide-react";
import { revertAction } from "@/lib/api";
import { CONTROL_BUTTON_CLASSNAME, INK, LINE, MUTED, RED, monoStyle } from "./ops-ui";

export function RevertActionButton({
  actionId,
  actionLabel,
  connectorLabel,
}: {
  actionId: string;
  actionLabel?: string;
  connectorLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function closeModal() {
    if (busy) {
      return;
    }
    setOpen(false);
    setError(null);
  }

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await revertAction(actionId);
      setOpen(false);
      startTransition(() => {
        router.refresh();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revert this action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition hover:bg-black/5"
        style={{ ...monoStyle, borderColor: "rgba(16,24,26,0.16)", color: "rgba(16,24,26,0.62)" }}
      >
        <Undo2 size={11} />
        Revert
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(16,24,26,0.45)" }}
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border bg-white p-5 shadow-xl"
            style={{ borderColor: LINE }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ background: "rgba(192,58,43,0.1)", color: RED }}
                >
                  <AlertTriangle size={18} />
                </span>
                <h2 className="text-[15px] font-semibold" style={{ color: INK }}>
                  Revert this action?
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={busy}
                className="rounded-md p-1 transition hover:bg-black/5 disabled:opacity-50"
                style={{ color: MUTED }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 space-y-2 text-[12.5px] leading-6" style={{ color: MUTED }}>
              <p>
                Conductor will undo{" "}
                <span className="font-semibold" style={{ color: INK }}>
                  {actionLabel || "this executed action"}
                </span>
                {connectorLabel ? (
                  <>
                    {" "}on <span className="font-semibold" style={{ color: INK }}>{connectorLabel}</span>
                  </>
                ) : null}{" "}
                by calling the Fivetran API to restore its previous state.
              </p>
              <p>No data already loaded into BigQuery is affected. The action will be marked as rolled back.</p>
            </div>

            {error ? (
              <p className="mt-3 rounded-lg border px-3 py-2 text-[11.5px]" style={{ ...monoStyle, borderColor: LINE, color: RED, background: "rgba(192,58,43,0.05)" }}>
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={busy}
                className={`${CONTROL_BUTTON_CLASSNAME} disabled:opacity-50`}
                style={{ ...monoStyle, borderColor: LINE, background: "#FFFFFF", color: MUTED }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={busy}
                className={`${CONTROL_BUTTON_CLASSNAME} disabled:opacity-50`}
                style={{ ...monoStyle, borderColor: RED, background: RED, color: "#FFFFFF" }}
              >
                {busy ? "Reverting…" : "Revert action"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
