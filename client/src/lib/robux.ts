import { formatEther } from "viem";

// Robux is the Roblox in-game currency this launchpad loops fees into.
// On Robinhood Chain it is represented by the RBLX token; the trading pair
// underneath every launch stays native ETH.
export const ROBUX_SYMBOL = "R$";
export const ROBUX_NAME = "Robux";
export const ROBUX_TICKER = "RBLX";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const precise = (max: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: max });

export function formatEth(value: bigint, max = 6): string {
  return precise(max).format(Number(formatEther(value)));
}

export function formatRobux(value: bigint, max = 2): string {
  return `${ROBUX_SYMBOL}${precise(max).format(Number(formatEther(value)))}`;
}

export function formatCompact(value: number): string {
  return compact.format(value);
}
