import type { Address, Hash } from "viem";

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
};

const STORAGE_KEY = "robux-loop:launch-feed:v1";
const MAX_RECORDS = 60;

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

export function getLaunchFeed(): LaunchRecord[] {
  return safeRead().sort((a, b) => b.createdAt - a.createdAt);
}

export function addLaunch(record: Omit<LaunchRecord, "id" | "createdAt">): LaunchRecord {
  const full: LaunchRecord = {
    ...record,
    id: `${record.txHash}-${Date.now()}`,
    createdAt: Date.now(),
  };
  const next = [full, ...safeRead()].slice(0, MAX_RECORDS);
  safeWrite(next);
  const sorted = getLaunchFeed();
  listeners.forEach((fn) => fn(sorted));
  return full;
}

export function subscribeFeed(fn: Listener): () => void {
  listeners.add(fn);
  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) fn(getLaunchFeed());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => listeners.delete(fn);
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
