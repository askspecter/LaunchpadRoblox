import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatEther,
  formatUnits,
  isAddress,
  parseEther,
  parseUnits,
  zeroAddress,
  type Address,
} from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import {
  contracts,
  curveAbi,
  curveBuyEvent,
  curveSellEvent,
  explorerAddress,
  explorerTx,
  factoryAbi,
  pairTokenSymbol,
  publicClient,
  readWithRetry,
  robinhoodChain,
  tokenAbi,
} from "@/lib/web3";
import { quoteBuy, quoteSell, spotPrice, withSlippage } from "@/lib/curveQuote";

const CHAIN_ID = robinhoodChain.id;

type Loaded = {
  curve: Address;
  isNative: boolean;
  pairToken: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellableTokens: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  realQuoteReserve: bigint;
  graduationThreshold: bigint;
  graduated: boolean;
};

type Trade = {
  side: "buy" | "sell";
  account: Address;
  quote: bigint;
  tokens: bigint;
  txHash: `0x${string}`;
  price: number;
};

const shorten = (v: string, n = 4) => `${v.slice(0, n + 2)}…${v.slice(-n)}`;

const fmtNum = (n: number, max = 4) =>
  n === 0
    ? "0"
    : n >= 1
      ? n.toLocaleString(undefined, { maximumFractionDigits: max })
      : n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

export function TokenDashboard({
  address,
  onBack,
}: {
  address: string;
  onBack: () => void;
}) {
  const { address: account, isConnected } = useAccount();
  const { open } = useAppKit();
  const { writeContractAsync } = useWriteContract();

  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tab, setTab] = useState<"trades" | "holders">("trades");

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(5);
  const [trading, setTrading] = useState(false);
  const [copied, setCopied] = useState(false);

  const valid = isAddress(address);
  const token = valid ? (address as Address) : zeroAddress;

  const load = useCallback(async () => {
    if (!valid) {
      setError("That is not a valid token address.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const launched = (await readWithRetry(() =>
        publicClient.readContract({
          address: contracts.ponsFactory,
          abi: factoryAbi,
          functionName: "getLaunchedToken",
          args: [token],
        }),
      )) as { curve: Address; pairToken: Address; exists: boolean };

      if (!launched.exists || launched.curve === zeroAddress) {
        throw new Error("This token was not launched through Pons V2.");
      }
      const curve = launched.curve;

      const [name, symbol, decimals, totalSupply] = await Promise.all([
        readWithRetry(() => publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" })),
        readWithRetry(() => publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" })),
        readWithRetry(() => publicClient.readContract({ address: token, abi: tokenAbi, functionName: "decimals" })),
        readWithRetry(() => publicClient.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" })),
      ]);

      const [reserves, sellableTokens, feeBps, creatorTaxBps, realQuoteReserve, graduationThreshold, graduated, isNative] =
        await Promise.all([
          readWithRetry(() => publicClient.readContract({ address: curve, abi: curveAbi, functionName: "getReserves" })),
          readWithRetry(() => publicClient.readContract({ address: curve, abi: curveAbi, functionName: "sellableTokens" })),
          readWithRetry(() => publicClient.readContract({ address: curve, abi: curveAbi, functionName: "feeBps" })),
          readWithRetry(() => publicClient.readContract({ address: curve, abi: curveAbi, functionName: "creatorTaxBps" })),
          readWithRetry(() => publicClient.readContract({ address: curve, abi: curveAbi, functionName: "realQuoteReserve" })),
          readWithRetry(() => publicClient.readContract({ address: curve, abi: curveAbi, functionName: "graduationThreshold" })),
          readWithRetry(() => publicClient.readContract({ address: curve, abi: curveAbi, functionName: "graduated" })),
          readWithRetry(() => publicClient.readContract({ address: curve, abi: curveAbi, functionName: "isNativeQuote" })),
        ]);

      const [quoteReserve, tokenReserve] = reserves as [bigint, bigint];
      setData({
        curve,
        isNative: isNative as boolean,
        pairToken: launched.pairToken,
        name: name as string,
        symbol: symbol as string,
        decimals: Number(decimals),
        totalSupply: totalSupply as bigint,
        quoteReserve,
        tokenReserve,
        sellableTokens: sellableTokens as bigint,
        feeBps: feeBps as bigint,
        creatorTaxBps: creatorTaxBps as bigint,
        realQuoteReserve: realQuoteReserve as bigint,
        graduationThreshold: graduationThreshold as bigint,
        graduated: graduated as boolean,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read this token.");
    } finally {
      setLoading(false);
    }
  }, [token, valid]);

  useEffect(() => {
    load();
  }, [load]);

  // Best-effort recent trades from curve events. Non-blocking; if the RPC
  // rejects the range we simply hide the list and keep the rest working.
  const loadTrades = useCallback(async (curve: Address, decimals: number) => {
    try {
      const [buys, sells] = await Promise.all([
        publicClient.getLogs({ address: curve, event: curveBuyEvent[0], fromBlock: BigInt(0), toBlock: "latest" }),
        publicClient.getLogs({ address: curve, event: curveSellEvent[0], fromBlock: BigInt(0), toBlock: "latest" }),
      ]);
      const rows: Trade[] = [];
      for (const l of buys) {
        const a = l.args as { recipient?: Address; quoteIn?: bigint; tokensOut?: bigint };
        if (a.quoteIn && a.tokensOut) {
          rows.push({
            side: "buy",
            account: a.recipient ?? zeroAddress,
            quote: a.quoteIn,
            tokens: a.tokensOut,
            txHash: l.transactionHash,
            price: Number(a.quoteIn) / Number(a.tokensOut) || 0,
          });
        }
      }
      for (const l of sells) {
        const a = l.args as { seller?: Address; tokensIn?: bigint; quoteOut?: bigint };
        if (a.tokensIn && a.quoteOut) {
          rows.push({
            side: "sell",
            account: a.seller ?? zeroAddress,
            quote: a.quoteOut,
            tokens: a.tokensIn,
            txHash: l.transactionHash,
            price: Number(a.quoteOut) / Number(a.tokensIn) || 0,
          });
        }
      }
      void decimals;
      setTrades(rows.reverse().slice(0, 40));
    } catch {
      setTrades([]);
    }
  }, []);

  useEffect(() => {
    if (data) loadTrades(data.curve, data.decimals);
  }, [data, loadTrades]);

  const quoteSymbol = data ? (data.isNative ? "ETH" : pairTokenSymbol) : pairTokenSymbol;

  const price = data ? spotPrice(data.quoteReserve, data.tokenReserve) : 0;
  const mcap = data ? price * Number(formatUnits(data.totalSupply, data.decimals)) : 0;
  const progress =
    data && data.graduationThreshold > BigInt(0)
      ? Math.min(100, (Number(data.realQuoteReserve) / Number(data.graduationThreshold)) * 100)
      : 0;

  const estimate = useMemo(() => {
    if (!data || !amount || Number(amount) <= 0) return null;
    try {
      const inputs = {
        quoteReserve: data.quoteReserve,
        tokenReserve: data.tokenReserve,
        sellableTokens: data.sellableTokens,
        feeBps: data.feeBps,
        creatorTaxBps: data.creatorTaxBps,
      };
      if (side === "buy") {
        const q = quoteBuy(parseEther(amount), inputs);
        return `≈ ${fmtNum(Number(formatUnits(q.tokensOut, data.decimals)))} ${data.symbol}`;
      }
      const out = quoteSell(parseUnits(amount, data.decimals), inputs);
      return `≈ ${fmtNum(Number(formatEther(out)), 6)} ${quoteSymbol}`;
    } catch {
      return null;
    }
  }, [amount, side, data, quoteSymbol]);

  const trade = async () => {
    if (!isConnected || !account) return open();
    if (!data) return;
    if (!amount || Number(amount) <= 0) return toast.error("Enter an amount.");
    setTrading(true);
    try {
      const inputs = {
        quoteReserve: data.quoteReserve,
        tokenReserve: data.tokenReserve,
        sellableTokens: data.sellableTokens,
        feeBps: data.feeBps,
        creatorTaxBps: data.creatorTaxBps,
      };
      const slipBps = Math.round(slippage * 100);
      let hash: `0x${string}`;
      if (side === "buy") {
        const quoteIn = parseEther(amount);
        const minOut = withSlippage(quoteBuy(quoteIn, inputs).tokensOut, slipBps);
        if (!data.isNative) {
          // ERC-20 quote (e.g. RBLX): approve the curve to pull the quote token.
          const approveHash = await writeContractAsync({
            chainId: CHAIN_ID,
            address: data.pairToken,
            abi: tokenAbi,
            functionName: "approve",
            args: [data.curve, quoteIn],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        hash = await writeContractAsync({
          chainId: CHAIN_ID,
          address: data.curve,
          abi: curveAbi,
          functionName: "buy",
          args: [quoteIn, minOut, account],
          value: data.isNative ? quoteIn : BigInt(0),
        });
      } else {
        const tokensIn = parseUnits(amount, data.decimals);
        const minOut = withSlippage(quoteSell(tokensIn, inputs), slipBps);
        const approveHash = await writeContractAsync({
          chainId: CHAIN_ID,
          address: token,
          abi: tokenAbi,
          functionName: "approve",
          args: [data.curve, tokensIn],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        hash = await writeContractAsync({
          chainId: CHAIN_ID,
          address: data.curve,
          abi: curveAbi,
          functionName: "sell",
          args: [tokensIn, minOut, account],
        });
      }
      toast.success("Trade submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(side === "buy" ? "Bought" : "Sold");
      setAmount("");
      await load();
    } catch (err) {
      const m = err instanceof Error ? err.message.split("\n")[0] : "Trade failed";
      toast.error(m.slice(0, 160));
    } finally {
      setTrading(false);
    }
  };

  const copyCa = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    toast.success("Contract address copied");
    setTimeout(() => setCopied(false), 1500);
  };

  // Simple price sparkline from trade prices.
  const spark = useMemo(() => {
    const pts = trades.map((t) => t.price).filter((p) => p > 0);
    if (pts.length < 2) return null;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const w = 600;
    const h = 140;
    const d = pts
      .map((p, i) => {
        const x = (i / (pts.length - 1)) * w;
        const y = h - ((p - min) / span) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return { d, w, h };
  }, [trades]);

  return (
    <section className="page container token-page">
      <div className="page-head">
        <button className="page-back" onClick={onBack}><ArrowLeft size={15} /> Feed</button>
      </div>

      {loading ? (
        <div className="token-loading"><LoaderCircle className="animate-spin" size={22} /> Reading token…</div>
      ) : error ? (
        <div className="token-error">
          <p>{error}</p>
          <div className="token-error-actions">
            <button onClick={load}>Retry</button>
            <a href={explorerAddress(token)} target="_blank" rel="noreferrer">Open in explorer <ExternalLink size={13} /></a>
          </div>
        </div>
      ) : data ? (
        <div className="token-grid">
          <div className="token-main">
            <div className="token-header">
              <div className="token-id">
                <div className="token-avatar">{data.symbol.slice(0, 3).toUpperCase()}</div>
                <div>
                  <h1>{data.name}</h1>
                  <div className="token-sub">
                    <span>${data.symbol}</span>
                    <span className="token-pairbadge">{quoteSymbol} pair</span>
                    {data.graduated && <span className="token-gradbadge">Graduated</span>}
                  </div>
                </div>
              </div>
              <button className="token-ca" onClick={copyCa}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {shorten(token, 5)}
              </button>
            </div>

            <div className="token-stats">
              <div><span>Price</span><strong>{fmtNum(price, 9)} {quoteSymbol}</strong></div>
              <div><span>Market cap</span><strong>{fmtNum(mcap, 4)} {quoteSymbol}</strong></div>
              <div><span>Supply</span><strong>{fmtNum(Number(formatUnits(data.totalSupply, data.decimals)), 0)}</strong></div>
              <div><span>Fee</span><strong>{(Number(data.feeBps) / 100).toFixed(2)}%</strong></div>
            </div>

            <div className="token-curve">
              <div className="token-curve-head">
                <span>Bonding curve</span>
                <strong>{progress.toFixed(1)}% to graduation</strong>
              </div>
              <div className="token-progress"><div style={{ width: `${progress}%` }} /></div>
              <p>{fmtNum(Number(formatEther(data.realQuoteReserve)), 6)} of {fmtNum(Number(formatEther(data.graduationThreshold)), 4)} {quoteSymbol} raised. At the threshold the curve closes and liquidity moves to a pool.</p>
            </div>

            {spark && (
              <div className="token-chart">
                <svg viewBox={`0 0 ${spark.w} ${spark.h}`} preserveAspectRatio="none" width="100%" height="140">
                  <path d={spark.d} fill="none" stroke="#ff7a1f" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                <span className="token-chart-note">Price across {trades.length} recent trades</span>
              </div>
            )}

            <div className="token-tabs">
              <button className={tab === "trades" ? "active" : ""} onClick={() => setTab("trades")}>Recent trades</button>
              <button className={tab === "holders" ? "active" : ""} onClick={() => setTab("holders")}>Holders</button>
              <a className="token-tab-explorer" href={explorerAddress(token)} target="_blank" rel="noreferrer">Explorer <ArrowUpRight size={12} /></a>
            </div>

            {tab === "trades" ? (
              trades.length === 0 ? (
                <p className="token-empty">No trades read yet. New buys and sells appear here; the explorer has the full history.</p>
              ) : (
                <ul className="token-trades">
                  {trades.map((t, i) => (
                    <li key={`${t.txHash}-${i}`} className={t.side}>
                      <span className="tt-side">{t.side === "buy" ? "Buy" : "Sell"}</span>
                      <span className="tt-amt">{fmtNum(Number(formatUnits(t.tokens, data.decimals)), 2)} {data.symbol}</span>
                      <span className="tt-quote">{fmtNum(Number(formatEther(t.quote)), 6)} {quoteSymbol}</span>
                      <a href={explorerTx(t.txHash)} target="_blank" rel="noreferrer" aria-label="View trade"><ExternalLink size={12} /></a>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="token-empty">Full holder distribution is served by the block explorer. <a href={explorerAddress(token)} target="_blank" rel="noreferrer">View holders <ArrowUpRight size={12} /></a></p>
            )}
          </div>

          <aside className="token-trade">
            <div className="token-trade-tabs">
              {(["buy", "sell"] as const).map((s) => (
                <button key={s} className={side === s ? `active ${s}` : ""} onClick={() => setSide(s)}>
                  {s === "buy" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
            <label className="token-trade-field">
              <span>Amount in {side === "buy" ? quoteSymbol : data.symbol}</span>
              <input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.0"
              />
            </label>
            {estimate && <p className="token-est">{estimate}</p>}
            <div className="token-slippage">
              <span>Slippage</span>
              {[1, 5, 10].map((s) => (
                <button key={s} className={slippage === s ? "active" : ""} onClick={() => setSlippage(s)}>{s}%</button>
              ))}
            </div>
            <button className={`token-trade-btn ${side}`} onClick={trade} disabled={trading || data.graduated}>
              {trading ? <LoaderCircle className="animate-spin" size={17} /> : side === "buy" ? "Buy" : "Sell"}
              {!trading && ` ${data.symbol}`}
            </button>
            {data.graduated && <p className="token-trade-note">This token has graduated — trade it on the pool via the explorer.</p>}
            <button className="token-refresh" onClick={load}><RefreshCw size={13} /> Refresh</button>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
