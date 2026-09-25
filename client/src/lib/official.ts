import { zeroAddress, type Address, type Hash } from "viem";
import { contracts, curveAbi, factoryAbi, publicClient, readWithRetry } from "./web3";
import { spotPrice } from "./curveQuote";
import type { LaunchRecord } from "./feed";

// Curated, official tokens pinned to the top of the live feed. Code-only: never
// written to the shared store, cannot be removed, and shown to every visitor.
export const OFFICIAL_TOKENS: LaunchRecord[] = [
  {
    id: "official:museblox",
    name: "MuseBlox",
    symbol: "MUSEBLOX",
    description: "The official MuseBlox token. Paired with RBLX.",
    logo: "/images/museblox-logo.jpg",
    website: "https://museblox.app",
    twitter: "https://x.com/musebloxapp",
    creatorTaxBps: 0,
    buybackEnabled: true,
    configId: "0",
    targetToken: contracts.targetToken,
    txHash: `0x${"0".repeat(64)}` as Hash,
    creator: zeroAddress,
    createdAt: 0, // sentinel: the card shows "Official" instead of a timestamp
    tokenAddress: "0x99395c56ac05b171394809688ccf9609db43cf1f" as Address,
    official: true,
  },
];

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
