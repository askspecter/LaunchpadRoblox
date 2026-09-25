import type { Address, Hash } from "viem";
import { OFFICIAL_TOKENS, isOfficialToken } from "./official";

// A launch recorded by this interface. The on-chain pair is always native ETH;
// `targetToken` is the Robux token that creator fees are looped into.
export type LaunchRecord = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  website: string;
  twitter: string;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  configId: string;
  targetToken: Address;
  txHash: Hash;
  creator: Address;
  createdAt: number;
  // Resolved from the launch receipt when available, so a token page can read
  // the curve and token state directly.
  tokenAddress?: Address;
  curveAddress?: Address;
  // Curated official token (e.g. $BLOX): pinned, non-removable, code-only.
  official?: boolean;
};

// v2: feed reset — old v1 caches/records are ignored so the feed starts empty.
const STORAGE_KEY = "robux-loop:launch-feed:v2";
const MAX_RECORDS = 60;
// Shared, server-side feed. Falls back to localStorage-only when the API or KV
// is unavailable (e.g. local `vite dev` with no backend).
const API = "/api/feed";
const POLL_MS = 12000;

type Listener = (records: LaunchRecord[]) => void;
const listeners = new Set<Listener>();

function safeRead(): LaunchRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LaunchRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function safeWrite(records: LaunchRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    /* storage unavailable (private mode, quota) — feed simply won't persist */
  }
}

function sortRecords(records: LaunchRecord[]): LaunchRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

function emit() {
  const sorted = getLaunchFeed();
  listeners.forEach((fn) => fn(sorted));
}

export function getLaunchFeed(): LaunchRecord[] {
  // Official tokens are pinned to the top and de-duped against any user record
  // that points at the same on-chain token.
  const user = sortRecords(safeRead()).filter(
    (r) => !isOfficialToken(r.tokenAddress),
  );
  return [...OFFICIAL_TOKENS, ...user];
}

// ---- shared (server) sync ---------------------------------------------------

async function apiGet(): Promise<LaunchRecord[] | null> {
  try {
    const res = await fetch(API, { headers: { accept: "application/json" } });
    if (!res.ok) return null; // 503 (KV off) / 404 (no backend) → stay local
    const data = (await res.json()) as { records?: LaunchRecord[] };
    return Array.isArray(data.records) ? data.records : null;
  } catch {
    return null;
  }
}

async function apiPost(record: LaunchRecord): Promise<void> {
  try {
    await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
  } catch {
    /* offline — record still lives in localStorage until the next sync */
  }
}

async function apiDelete(id: string): Promise<void> {
  try {
    await fetch(`${API}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* offline — deletion still applied locally */
  }
}

// Pull the shared feed, merge it with anything only this browser has, and push
// those local-only launches up so an existing (pre-KV) launch becomes global.
let migrated = false;
async function refreshFromServer(): Promise<void> {
  const server = await apiGet();
  if (server === null) return; // no shared backend reachable; keep local cache

  const local = safeRead();
  const byId = new Map<string, LaunchRecord>();
  for (const r of server.concat(local)) if (!byId.has(r.id)) byId.set(r.id, r);
  const merged = sortRecords(Array.from(byId.values())).slice(0, MAX_RECORDS);
  safeWrite(merged);
  emit();

  if (!migrated) {
    migrated = true;
    const serverIds = new Set(server.map((r) => r.id));
    for (const r of local) if (!serverIds.has(r.id)) void apiPost(r);
  }
}

// ---- mutations --------------------------------------------------------------

export function addLaunch(record: Omit<LaunchRecord, "id" | "createdAt">): LaunchRecord {
  const full: LaunchRecord = {
    ...record,
    id: `${record.txHash}-${Date.now()}`,
    createdAt: Date.now(),
  };
  safeWrite([full, ...safeRead()].slice(0, MAX_RECORDS));
  emit();
  void apiPost(full).then(refreshFromServer); // publish, then reconcile
  return full;
}

export function removeLaunch(id: string): void {
  if (id.startsWith("official:")) return; // official tokens can't be removed
  safeWrite(safeRead().filter((record) => record.id !== id));
  emit();
  void apiDelete(id);
}

// Re-insert a previously removed record (keeps its original id/createdAt) so a
// delete can be undone from the toast.
export function restoreLaunch(record: LaunchRecord): void {
  safeWrite([record, ...safeRead().filter((r) => r.id !== record.id)].slice(0, MAX_RECORDS));
  emit();
  void apiPost(record);
}

export function subscribeFeed(fn: Listener): () => void {
  listeners.add(fn);

  // Initial + periodic pull from the shared feed, plus a refresh when the tab
  // regains focus so other people's launches appear without a manual reload.
  void refreshFromServer();
  const timer =
    typeof window !== "undefined"
      ? window.setInterval(() => void refreshFromServer(), POLL_MS)
      : undefined;
  const onVisible = () => {
    if (document.visibilityState === "visible") void refreshFromServer();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) fn(getLaunchFeed());
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
  }

  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer !== undefined) window.clearInterval(timer);
    }
  };
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
