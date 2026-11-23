"use client";

import { useCallback, useEffect, useState } from "react";

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return "p-" + Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function getPlayerId(): string {
  let id = localStorage.getItem("ga:pid");
  if (!id || id.length < 8) {
    id = uuid();
    localStorage.setItem("ga:pid", id);
  }
  return id;
}

export function usePlayer() {
  const [player, setPlayer] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    setPlayer({ id: getPlayerId(), name: localStorage.getItem("ga:name") ?? "" });
  }, []);
  const setName = useCallback((name: string) => {
    localStorage.setItem("ga:name", name);
    setPlayer((p) => (p ? { ...p, name } : p));
  }, []);
  return { player, setName };
}

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}
