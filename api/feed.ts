// Shared launch feed backed by Vercel KV (Upstash Redis REST).
//
// Without this, the feed lived only in each visitor's localStorage, so a launch
// made in one browser never showed up in another. This endpoint stores the feed
// in KV so every visitor sees the same list.
//
// Env (set automatically when a Vercel KV / Upstash store is connected):
//   KV_REST_API_URL   / UPSTASH_REDIS_REST_URL
//   KV_REST_API_TOKEN / UPSTASH_REDIS_REST_TOKEN

export const config = { runtime: "edge" };

// v2: feed reset — a fresh KV list, so the shared feed starts empty for everyone.
const KEY = "bloxpad:feed:v2";
const MAX_RECORDS = 60;

const REST_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_REST_API_URL ||
  "";
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.REDIS_REST_API_TOKEN ||
  "";

type Json = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Run one Redis command through the Upstash REST API.
async function kv(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${REST_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`kv ${command[0]} -> ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}

function configured(): boolean {
  return Boolean(REST_URL && REST_TOKEN);
}

async function readFeed(): Promise<Json[]> {
  const raw = (await kv(["LRANGE", KEY, "0", String(MAX_RECORDS - 1)])) as unknown[];
  const out: Json[] = [];
  for (const item of raw || []) {
    try {
      out.push(JSON.parse(String(item)) as Json);
    } catch {
      /* skip malformed entries */
    }
  }
  return out;
}

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.slice(0, max) : "";

// Keep only known fields and cap their sizes; anyone can POST, so never trust
// the body blindly.
function sanitize(input: Json): Json | null {
  const id = str(input.id, 120);
  const symbol = str(input.symbol, 24);
  const name = str(input.name, 80);
  if (!id || !symbol) return null;
  const createdAt =
    typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
      ? input.createdAt
      : Date.now();
  const taxRaw = Number(input.creatorTaxBps);
  return {
    id,
    name,
    symbol,
    description: str(input.description, 600),
    logo: str(input.logo, 200000),
    website: str(input.website, 400),
    twitter: str(input.twitter, 400),
    creatorTaxBps: Number.isFinite(taxRaw) ? Math.max(0, Math.min(10000, taxRaw)) : 0,
    buybackEnabled: Boolean(input.buybackEnabled),
    configId: str(input.configId, 40),
    targetToken: str(input.targetToken, 60),
    txHash: str(input.txHash, 80),
    creator: str(input.creator, 60),
    createdAt,
    ...(str(input.tokenAddress, 60) ? { tokenAddress: str(input.tokenAddress, 60) } : {}),
    ...(str(input.curveAddress, 60) ? { curveAddress: str(input.curveAddress, 60) } : {}),
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (!configured()) {
    // KV not connected — tell the client so it can fall back to localStorage.
    return json({ error: "kv_not_configured", records: [] }, 503);
  }

  try {
    if (req.method === "GET") {
      const records = await readFeed();
      records.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
      return json({ records });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as Json | null;
      if (!body) return json({ error: "bad_json" }, 400);
      const record = sanitize(body);
      if (!record) return json({ error: "invalid_record" }, 400);

      // Idempotent by id so a client retry (or migration) never duplicates.
      const existing = await readFeed();
      if (!existing.some((r) => r.id === record.id)) {
        await kv(["LPUSH", KEY, JSON.stringify(record)]);
        await kv(["LTRIM", KEY, "0", String(MAX_RECORDS - 1)]);
      }
      return json({ record });
    }

    if (req.method === "DELETE") {
      const params = new URL(req.url).searchParams;
      // Admin: wipe the entire shared feed in one call (DELETE /api/feed?all=1).
      if (params.get("all")) {
        await kv(["DEL", KEY]);
        return json({ ok: true, cleared: true });
      }
      const id = params.get("id") || "";
      if (!id) return json({ error: "missing_id" }, 400);
      const remaining = (await readFeed()).filter((r) => r.id !== id);
      await kv(["DEL", KEY]);
      if (remaining.length) {
        await kv(["RPUSH", KEY, ...remaining.map((r) => JSON.stringify(r))]);
      }
      return json({ ok: true });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "kv_error" }, 500);
  }
}
