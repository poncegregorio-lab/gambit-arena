import os from "node:os";

export interface LanInfo {
  /** Port the app is served on (defaults to 3000). */
  port: number;
  hostname: string;
  /** Addresses other devices on this WiFi/LAN can reach us at, most useful first. */
  urls: { label: string; url: string; kind: "lan" | "loopback" | "public" }[];
}

/** Private (RFC1918) addresses are usable on the local network; link-local ones only sometimes are. */
function kindFor(ip: string): "lan" | "loopback" | "public" {
  if (ip.startsWith("127.")) return "loopback";
  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.2") ||
    ip.startsWith("172.3")
  ) {
    return "lan";
  }
  if (ip.startsWith("169.254.")) return "lan"; // link-local: still the best guess on this host
  return "public";
}

export function getLanInfo(port = Number(process.env.PORT) || 3000): LanInfo {
  const entries: LanInfo["urls"] = [];
  const seen = new Set<string>();
  const add = (label: string, url: string, kind: LanInfo["urls"][number]["kind"]) => {
    if (seen.has(url)) return;
    seen.add(url);
    entries.push({ label, url, kind });
  };
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      add(kindFor(a.address) === "lan" ? "WiFi / LAN" : "This device", `http://${a.address}:${port}`, kindFor(a.address));
    }
  }
  add("This computer", `http://127.0.0.1:${port}`, "loopback");
  // Stable mDNS-style name when the host provides one (e.g. e2b.local).
  const host = os.hostname();
  if (host && host.includes(".")) add(host, `http://${host}:${port}`, "lan");
  entries.sort((a, b) => ({ lan: 0, public: 1, loopback: 2 }[a.kind] - { lan: 0, public: 1, loopback: 2 }[b.kind]));
  return { port, hostname: host, urls: entries };
}
