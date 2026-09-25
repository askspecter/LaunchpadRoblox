import { zeroAddress, type Address } from "viem";
import { contracts, curveAbi, factoryAbi, publicClient, readWithRetry } from "./web3";
import { spotPrice } from "./curveQuote";
import type { LaunchRecord } from "./feed";

// Curated, official tokens pinned to the top of the live feed. Empty for now —
// no official token is listed (the previous $BLOX pin was removed).
export const OFFICIAL_TOKENS: LaunchRecord[] = [];

const OFFICIAL_ADDRS = new Set(
  OFFICIAL_TOKENS.map((t) => (t.tokenAddress ?? "").toLowerCase()).filter(Boolean),
);

export const isOfficialToken = (address?: string): boolean =>
  Boolean(address && OFFICIAL_ADDRS.has(address.toLowerCase()));

// Live spot price of a token in RBLX, read straight from its Pons curve.
// Returns null when the token has no curve or can't be read right now (e.g. it
// graduated to a pool, or the RPC is unreachable) so the UI can degrade to a
// plain "Live" state instead of breaking.
export async function fetchSpotPriceRBLX(token: Address): Promise<number | null> {
  try {
    const launched = (await readWithRetry(() =>
      publicClient.readContract({
        address: contracts.ponsFactory,
        abi: factoryAbi,
        functionName: "getLaunchedToken",
        args: [token],
      }),
    )) as { curve: Address; pairToken: Address; exists: boolean };

    if (!launched.exists || launched.curve === zeroAddress) return null;

    const reserves = (await readWithRetry(() =>
      publicClient.readContract({
        address: launched.curve,
        abi: curveAbi,
        functionName: "getReserves",
      }),
    )) as [bigint, bigint];

    return spotPrice(reserves[0], reserves[1]);
  } catch {
    return null;
  }
}
