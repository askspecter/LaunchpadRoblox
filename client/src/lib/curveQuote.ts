// Pons V2 bonding-curve quoting — pure integer math, reproduced from the
// official curve order. Buys charge fees on the way in; sells are priced first
// and fees come off the output. Only buys carry the snipe tax.

const BPS = BigInt(10000);
const ONE = BigInt(1);
const ZERO = BigInt(0);
const ceilDiv = (a: bigint, b: bigint) => (a + b - ONE) / b;

function amountOut(inAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (inAmount * reserveOut) / (reserveIn + inAmount);
}
function amountIn(outAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (outAmount * reserveIn) / (reserveOut - outAmount) + ONE;
}

export interface CurveQuoteInputs {
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellableTokens: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  snipeBps?: bigint;
}

export interface BuyQuote {
  tokensOut: bigint;
  spent: bigint;
  refund: bigint;
}

/** Quote asset in → launch token out. */
export function quoteBuy(quoteIn: bigint, i: CurveQuoteInputs): BuyQuote {
  const { feeBps, creatorTaxBps } = i;
  let snipeBps = i.snipeBps ?? ZERO;
  if (snipeBps > ZERO) {
    const maxSnipeBps = BPS - feeBps - creatorTaxBps - BigInt(100);
    if (snipeBps > maxSnipeBps) snipeBps = maxSnipeBps;
  }

  let spent = quoteIn;
  const fee = (spent * feeBps) / BPS;
  const tax = (spent * creatorTaxBps) / BPS;
  const snipeTax = (spent * snipeBps) / BPS;
  let tokensOut = amountOut(spent - fee - tax - snipeTax, i.quoteReserve, i.tokenReserve);

  if (tokensOut > i.sellableTokens) {
    tokensOut = i.sellableTokens;
    const net = amountIn(i.sellableTokens, i.quoteReserve, i.tokenReserve);
    const grossed = ceilDiv(net * BPS, BPS - feeBps - creatorTaxBps - snipeBps);
    spent = grossed < quoteIn ? grossed : quoteIn;
  }

  return { tokensOut, spent, refund: quoteIn - spent };
}

/** Launch token in → quote asset out. No snipe tax on this side. */
export function quoteSell(tokensIn: bigint, i: CurveQuoteInputs): bigint {
  const gross = amountOut(tokensIn, i.tokenReserve, i.quoteReserve);
  const fee = (gross * i.feeBps) / BPS;
  const tax = (gross * i.creatorTaxBps) / BPS;
  return gross - fee - tax;
}

/** Apply a slippage tolerance (in bps) to a quoted output → a min-out floor. */
export function withSlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10000 - slippageBps)) / BPS;
}

/**
 * Spot price of one token in the quote asset, derived from reserves. Both
 * reserves are 18-decimal in the curve's quote math. Returns a JS number that
 * is only used for display.
 */
export function spotPrice(quoteReserve: bigint, tokenReserve: bigint): number {
  if (tokenReserve === ZERO) return 0;
  return Number(quoteReserve) / Number(tokenReserve);
}
