import { keccak256, toBytes, type Address, type Hash } from "viem";

// The Robux order store (manual fulfillment).
//
// A buyer pays native ETH to the store treasury. Once that payment confirms
// on-chain, this module derives a one-off order code that is cryptographically
// bound to the payment transaction hash — so every code maps to exactly one
// real, explorer-verifiable payment and cannot be minted out of thin air.
//
// IMPORTANT: this software does NOT mint, hold, or auto-convert anything into
// Robux. The code is a proof-of-purchase / order reference. Robux is delivered
// MANUALLY by the store operator after payment, off-chain. There is no
// automatic crypto-to-Robux conversion here, by design — that cannot be done
// legitimately, and any site claiming it is a scam.

export type StorePack = {
  id: string;
  robux: number; // headline RBLX amount for the pack
  priceEth: string; // fixed price in native ETH
  bonusPct?: number; // extra RBLX included, for display only
  popular?: boolean;
  tagline: string;
};

// Fixed-price packs. Prices are deliberately small placeholders — the operator
// tunes these to a real RBLX/ETH quote before going live.
export const STORE_PACKS: StorePack[] = [
  { id: "starter", robux: 400, priceEth: "0.0008", tagline: "A quick top-up" },
  { id: "plus", robux: 1000, priceEth: "0.0018", bonusPct: 5, tagline: "Most picked", popular: true },
  { id: "pro", robux: 2500, priceEth: "0.0042", bonusPct: 8, tagline: "Better rate" },
  { id: "max", robux: 6000, priceEth: "0.0095", bonusPct: 12, tagline: "Best value" },
];

export const getPack = (id: string): StorePack | undefined =>
  STORE_PACKS.find((p) => p.id === id);

/** RBLX delivered including the display bonus. */
export const packTotalRobux = (pack: StorePack): number =>
  Math.round(pack.robux * (1 + (pack.bonusPct ?? 0) / 100));

// Crockford-style base32 without ambiguous glyphs (no I, L, O, U).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const INDEX = new Map(ALPHABET.split("").map((c, i) => [c, i] as const));

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

const checksum = (body: string): string => {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += INDEX.get(body[i]) ?? 0;
  return ALPHABET[sum % 32];
};

const format = (chars16: string): string =>
  `MUSE-${chars16.slice(0, 4)}-${chars16.slice(4, 8)}-${chars16.slice(8, 12)}-${chars16.slice(12, 16)}`;

/**
 * Derive the redeem code for a confirmed payment. Deterministic: the same
 * (txHash, packId) always yields the same code, and any other input yields a
 * different one, so a code is a verifiable pointer back to one payment.
 */
export function deriveCode(txHash: Hash, packId: string): string {
  const digest = toBytes(keccak256(toBytes(`${txHash.toLowerCase()}:${packId}`)));
  const body = base32(digest).slice(0, 15); // 15 data chars
  return format(body + checksum(body));
}

/** Normalise user-typed input: uppercase, fix look-alikes, strip separators. */
export function normalizeCode(input: string): string {
  // Strip everything but letters/digits first, so a leading space or missing
  // dash never blocks the prefix removal. The 16-char body can never start with
  // "BLOX" (the alphabet excludes L and O), so this is unambiguous.
  let body = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (body.startsWith("BLOX")) body = body.slice(4);
  return body
    .replace(/I/g, "1")
    .replace(/L/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
}

/** True when the code is well-formed and its checksum digit is consistent. */
export function isValidCodeFormat(input: string): boolean {
  const body = normalizeCode(input);
  if (body.length !== 16) return false;
  if (!body.split("").every((c) => INDEX.has(c))) return false;
  return checksum(body.slice(0, 15)) === body[15];
}

export type StoreOrder = {
  id: string;
  packId: string;
  robux: number;
  priceEth: string;
  code: string;
  txHash: Hash;
  buyer: Address;
  status: "active" | "redeemed";
  createdAt: number;
  redeemedAt?: number;
};

const STORAGE_KEY = "robux-loop:store-orders:v1";
const MAX_ORDERS = 100;

type Listener = (orders: StoreOrder[]) => void;
const listeners = new Set<Listener>();

function safeRead(): StoreOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoreOrder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(orders: StoreOrder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders.slice(0, MAX_ORDERS)));
  } catch {
    /* storage unavailable (private mode / quota) — orders just won't persist */
  }
}

function emit(orders: StoreOrder[]) {
  const sorted = orders.sort((a, b) => b.createdAt - a.createdAt);
  listeners.forEach((fn) => fn(sorted));
}

export function getOrders(): StoreOrder[] {
  return safeRead().sort((a, b) => b.createdAt - a.createdAt);
}

export function recordOrder(
  input: Omit<StoreOrder, "id" | "status" | "createdAt">,
): StoreOrder {
  const order: StoreOrder = {
    ...input,
    id: `${input.txHash}-${input.packId}`,
    status: "active",
    createdAt: Date.now(),
  };
  const next = [order, ...safeRead().filter((o) => o.id !== order.id)].slice(0, MAX_ORDERS);
  safeWrite(next);
  emit(next);
  return order;
}

export type RedeemResult =
  | { ok: true; order: StoreOrder }
  | { ok: false; reason: "format" | "unknown" | "already" };

/**
 * Redeem a code against the locally recorded orders. Marks the matching order
 * redeemed so a code can only be spent once on this device.
 */
export function redeemCode(input: string): RedeemResult {
  if (!isValidCodeFormat(input)) return { ok: false, reason: "format" };
  const target = normalizeCode(input);
  const orders = safeRead();
  const match = orders.find((o) => normalizeCode(o.code) === target);
  if (!match) return { ok: false, reason: "unknown" };
  if (match.status === "redeemed") return { ok: false, reason: "already" };
  const next = orders.map((o) =>
    o.id === match.id ? { ...o, status: "redeemed" as const, redeemedAt: Date.now() } : o,
  );
  safeWrite(next);
  emit(next);
  return { ok: true, order: { ...match, status: "redeemed", redeemedAt: Date.now() } };
}

export function subscribeOrders(fn: Listener): () => void {
  listeners.add(fn);
  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) fn(getOrders());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => listeners.delete(fn);
}
