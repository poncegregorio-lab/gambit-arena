"use client";

import { useEffect, useState } from "react";
import type { LanInfo } from "@/lib/server/network";

/**
 * Shows how to open this app from another device on the same WiFi, with a QR code to scan.
 * The app listens on 0.0.0.0, so any phone, tablet or laptop on this network can join.
 */
export function WifiPanel() {
  const [info, setInfo] = useState<LanInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await fetch("/api/info", { cache: "no-store" });
        const data = (await res.json()) as LanInfo;
        if (stop) return;
        setInfo(data);
        const primary = data.urls.find((u) => u.kind === "lan") ?? data.urls[0];
        if (primary) {
          const QRCode = (await import("qrcode")).default;
          const url = await QRCode.toDataURL(primary.url, {
            width: 240,
            margin: 1,
            color: { dark: "#0a0d13", light: "#f5b942" },
          });
          if (!stop) setQr(url);
        }
      } catch {
        if (!stop) setError(true);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  if (error) return null;
  const primary = info?.urls.find((u) => u.kind === "lan") ?? info?.urls[0] ?? null;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#5ab4ff]/20 bg-[#5ab4ff]/10 text-lg">
          📶
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">Play over this WiFi</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-[#8d96ab]">
            The app listens on every network interface, so anyone on the same WiFi can open it on their own phone, tablet or laptop.
          </p>
        </div>
      </div>

      <div className="flex gap-4 px-4 pb-4">
        <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#f5b942] p-1.5">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code linking to this app" className="h-full w-full" />
          ) : (
            <span className="text-[10px] font-bold text-[#1a1304]">…</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <code className="block truncate rounded-lg bg-black/40 px-2.5 py-2 text-[13px] font-semibold text-amber-300" title={primary?.url}>
            {primary ? primary.url.replace(/^https?:\/\//, "") : "…"}
          </code>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary !px-3 !py-1.5 !text-xs"
              disabled={!primary}
              onClick={async () => {
                if (!primary) return;
                try {
                  await navigator.clipboard.writeText(primary.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              {copied ? "Copied ✓" : "Copy address"}
            </button>
            {primary && (
              <a className="btn btn-ghost !px-3 !py-1.5 !text-xs" href={primary.url} target="_blank" rel="noreferrer">
                Open here
              </a>
            )}
          </div>
          <p className="text-[10.5px] leading-snug text-[#6f788d]">
            {primary?.kind === "lan"
              ? "Scan the code or type the address. Same WiFi network required."
              : "No WiFi address found yet — this device is only reachable from itself right now."}
          </p>
        </div>
      </div>
    </div>
  );
}
