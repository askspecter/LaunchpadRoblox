import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Box,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FileText,
  Fuel,
  Globe,
  LayoutGrid,
  LoaderCircle,
  Menu as MenuIcon,
  Network,
  Radio,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  isAddress,
  isAddressEqual,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { Button } from "@/components/ui/button";
import {
  adapterAbi,
  contracts,
  curveFeeAbi,
  escrowAbi,
  explorerAddress,
  explorerTx,
  factoryAbi,
  hookFeeAbi,
  publicClient,
  robinhoodChain,
  type LaunchConfig,
} from "@/lib/web3";
import {
  addLaunch,
  getLaunchFeed,
  subscribeFeed,
  timeAgo,
  type LaunchRecord,
} from "@/lib/feed";
import { formatEth, ROBUX_NAME, ROBUX_TICKER } from "@/lib/robux";

type FormState = {
  name: string;
  symbol: string;
  description: string;
  logo: string;
  website: string;
  twitter: string;
  creatorTax: string;
  buybackEnabled: boolean;
};

type ClaimMode = "escrow" | "curve" | "pool";
type FeedFilter = "all" | "mine" | "buyback";
type View = "feed" | "launch" | "claim" | "how" | "contracts";

const CHAIN_ID = 4663;

const initialForm: FormState = {
  name: "",
  symbol: "",
  description: "",
  logo: "",
  website: "",
  twitter: "",
  creatorTax: "0",
  buybackEnabled: false,
};

const MENU_LINKS: { view: View; label: string; icon: typeof LayoutGrid }[] = [
  { view: "feed", label: "Explore feed", icon: LayoutGrid },
  { view: "launch", label: "Launch a coin", icon: Rocket },
  { view: "claim", label: "Claim fees", icon: Zap },
  { view: "how", label: "How it works", icon: Sparkles },
  { view: "contracts", label: "Contracts", icon: ShieldCheck },
];

const viewFromHash = (): View => {
  const h = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#\/?/, "");
  return h === "launch" || h === "claim" || h === "how" || h === "contracts" ? h : "feed";
};

const shorten = (value: string, size = 5) =>
  `${value.slice(0, size + 2)}…${value.slice(-size)}`;

const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value);
  toast.success("Address copied");
};

function StatusPill({ ready }: { ready: boolean }) {
  return (
    <span className={`status-pill ${ready ? "status-ready" : "status-warn"}`}>
      <span className="status-dot" />
      {ready ? "Adapter ready" : "Deployment required"}
    </span>
  );
}

function AddressRow({ label, address }: { label: string; address: Address }) {
  const isUnset = isAddressEqual(address, zeroAddress);
  return (
    <div className="address-row">
      <div>
        <span className="address-label">{label}</span>
        <span className={`address-value ${isUnset ? "text-amber-300" : ""}`}>
          {isUnset ? "Not configured" : shorten(address, 7)}
        </span>
      </div>
      {!isUnset && (
        <div className="flex items-center gap-1">
          <button className="icon-button" onClick={() => copyText(address)} aria-label={`Copy ${label}`}>
            <Copy size={15} />
          </button>
          <a className="icon-button" href={explorerAddress(address)} target="_blank" rel="noreferrer" aria-label={`Open ${label} in explorer`}>
            <ExternalLink size={15} />
          </a>
        </div>
      )}
    </div>
  );
}

function FeedCard({ record }: { record: LaunchRecord }) {
  const ticker = record.symbol.toUpperCase();
  return (
    <article className="feed-card">
      <div className="feed-media">
        {record.logo ? (
          <img
            src={record.logo}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <span className="feed-media-fallback">{ticker.slice(0, 4)}</span>
        <span className="feed-badge"><Zap size={11} /> {ROBUX_TICKER} loop</span>
        {record.buybackEnabled && <span className="feed-badge feed-badge-buyback">Buyback</span>}
      </div>
      <div className="feed-body">
        <div className="feed-heading">
          <strong title={record.name}>{record.name}</strong>
          <span>${ticker}</span>
        </div>
        <div className="feed-subline">
          <span className="feed-pair">ETH pair</span>
          <span className="feed-time">{timeAgo(record.createdAt)}</span>
        </div>
        {record.description && <p className="feed-desc">{record.description}</p>}
        <div className="feed-links">
          <a href={explorerTx(record.txHash)} target="_blank" rel="noreferrer">
            Transaction <ArrowUpRight size={12} />
          </a>
          {record.website && (
            <a href={record.website} target="_blank" rel="noreferrer">
              <Globe size={12} /> Site
            </a>
          )}
          <span className="feed-creator">by {shorten(record.creator, 4)}</span>
        </div>
      </div>
    </article>
  );
}

export default function Home() {
  const { address: account, chainId, isConnected } = useAccount();
  const { open } = useAppKit();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [view, setView] = useState<View>(viewFromHash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [configs, setConfigs] = useState<LaunchConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<bigint>(BigInt(0));
  const [launchFee, setLaunchFee] = useState<bigint>(BigInt(0));
  const [claimable, setClaimable] = useState<bigint>(BigInt(0));
  const [adapterOwner, setAdapterOwner] = useState<Address | null>(null);
  const [canLaunch, setCanLaunch] = useState<boolean | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [minRblxOut, setMinRblxOut] = useState("");
  const [claimMode, setClaimMode] = useState<ClaimMode>("escrow");
  const [curveAddress, setCurveAddress] = useState("");
  const [poolId, setPoolId] = useState("");
  const [pendingFees, setPendingFees] = useState<bigint | null>(null);
  const [loading, setLoading] = useState<"launch" | "claim" | "fees" | null>(null);
  const [lastHash, setLastHash] = useState<Hash | null>(null);
  const [feed, setFeed] = useState<LaunchRecord[]>([]);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");

  const adapterReady = !isAddressEqual(contracts.claimAdapter, zeroAddress);
  const isAdapterOwner = Boolean(
    account && adapterOwner && isAddressEqual(account, adapterOwner),
  );
  const activeConfig = useMemo(
    () => configs.find((config) => config.id === selectedConfig),
    [configs, selectedConfig],
  );

  const filteredFeed = useMemo(() => {
    if (feedFilter === "mine")
      return feed.filter((r) => account && isAddressEqual(r.creator, account));
    if (feedFilter === "buyback") return feed.filter((r) => r.buybackEnabled);
    return feed;
  }, [feed, feedFilter, account]);

  useEffect(() => {
    setFeed(getLaunchFeed());
    return subscribeFeed(setFeed);
  }, []);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const navigate = useCallback((next: View) => {
    setMenuOpen(false);
    setView(next);
    const target = next === "feed" ? "#/" : `#/${next}`;
    if (window.location.hash !== target) window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const refreshProtocol = useCallback(async () => {
    try {
      const [count, fee] = await Promise.all([
        publicClient.readContract({
          address: contracts.ponsFactory,
          abi: factoryAbi,
          functionName: "launchConfigCount",
        }),
        publicClient.readContract({
          address: contracts.ponsFactory,
          abi: factoryAbi,
          functionName: "launchFee",
        }),
      ]);

      const records = await publicClient.multicall({
        allowFailure: false,
        contracts: Array.from({ length: Number(count) }, (_, index) => ({
          address: contracts.ponsFactory,
          abi: factoryAbi,
          functionName: "getLaunchConfig" as const,
          args: [BigInt(index)] as const,
        })),
      });

      const open = records
        .map((record, index) => ({ id: BigInt(index), ...record }))
        .filter((record) => record.enabled) as LaunchConfig[];

      setConfigs(open);
      setLaunchFee(fee);
      if (open.length > 0)
        setSelectedConfig((current) =>
          open.some((item) => item.id === current) ? current : open[0].id,
        );
    } catch {
      toast.error("Could not read Pons data. The public RPC may be rate limited.");
    }
  }, []);

  const refreshWalletState = useCallback(
    async (wallet?: Address | null) => {
      const activeAccount = wallet ?? account;
      try {
        const reads: Promise<unknown>[] = [];
        if (adapterReady) {
          reads.push(
            publicClient.readContract({
              address: contracts.ponsFeeEscrow,
              abi: escrowAbi,
              functionName: "balanceOf",
              args: [contracts.claimAdapter],
            }),
          );
          reads.push(
            publicClient.readContract({
              address: contracts.claimAdapter,
              abi: adapterAbi,
              functionName: "owner",
            }),
          );
        }
        if (activeAccount) {
          reads.push(
            publicClient.readContract({
              address: contracts.ponsFactory,
              abi: factoryAbi,
              functionName: "canLaunch",
              args: [activeAccount],
            }),
          );
        }
        const result = await Promise.all(reads);
        let cursor = 0;
        if (adapterReady) {
          setClaimable(result[cursor++] as bigint);
          setAdapterOwner(result[cursor++] as Address);
        }
        if (activeAccount) setCanLaunch(result[cursor] as boolean);
      } catch {
        setCanLaunch(null);
      }
    },
    [account, adapterReady],
  );

  useEffect(() => {
    refreshProtocol();
  }, [refreshProtocol]);

  useEffect(() => {
    refreshWalletState(account ?? null);
  }, [account, refreshWalletState]);

  const ensureChain = useCallback(async () => {
    if (chainId === CHAIN_ID) return;
    try {
      await switchChainAsync({ chainId: CHAIN_ID });
    } catch {
      throw new Error(
        `Switch your wallet to ${robinhoodChain.name} (chain ID ${CHAIN_ID}).`,
      );
    }
  }, [chainId, switchChainAsync]);

  const launch = async () => {
    if (!isConnected || !account) return open();
    if (!adapterReady)
      return toast.error("Deploy ClaimToRBLXAdapter, then set VITE_CLAIM_ADAPTER_ADDRESS.");
    if (!adapterOwner)
      return toast.error("Adapter owner could not be verified onchain yet.");
    if (adapterOwner && !isAdapterOwner)
      return toast.error("This wallet is not the adapter owner. Use the adapter dedicated to this launch.");
    if (!form.name.trim() || !form.symbol.trim() || !form.description.trim())
      return toast.error("Name, ticker, and description are required.");
    if (!activeConfig) return toast.error("No active Pons launch configuration.");
    if (canLaunch === false)
      return toast.error("This address is not yet allowed to launch on Pons V2.");

    setLoading("launch");
    try {
      await ensureChain();
      const expectedEconomics = await publicClient.readContract({
        address: contracts.ponsFactory,
        abi: factoryAbi,
        functionName: "previewLaunchEconomics",
        args: [selectedConfig, zeroAddress],
      });
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const creatorTaxBps = Number(form.creatorTax);
      const hash = await writeContractAsync({
        chainId: CHAIN_ID,
        address: contracts.ponsFactory,
        abi: factoryAbi,
        functionName: "launchToken",
        args: [
          {
            name: form.name.trim(),
            symbol: form.symbol.trim().toUpperCase(),
            logo: form.logo.trim(),
            description: form.description.trim(),
            socials: {
              twitter: form.twitter.trim(),
              telegram: "",
              discord: "",
              website: form.website.trim(),
              farcaster: "",
            },
            creatorFeeRecipient: contracts.claimAdapter,
            creatorTaxBps,
            buybackEnabled: form.buybackEnabled,
            expectedEconomics,
            salt,
          },
          selectedConfig,
          zeroAddress,
        ],
        value: launchFee,
      });
      setLastHash(hash);
      addLaunch({
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        description: form.description.trim(),
        logo: form.logo.trim(),
        website: form.website.trim(),
        twitter: form.twitter.trim(),
        creatorTaxBps,
        buybackEnabled: form.buybackEnabled,
        configId: selectedConfig.toString(),
        targetToken: contracts.targetToken,
        txHash: hash,
        creator: account,
      });
      setForm(initialForm);
      toast.success("Launch transaction submitted. Added to the live feed.");
      navigate("feed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 160) : "Launch failed");
    } finally {
      setLoading(null);
    }
  };

  const readPendingFees = async () => {
    setLoading("fees");
    try {
      if (claimMode === "curve") {
        if (!isAddress(curveAddress)) throw new Error("Invalid curve address.");
        const [baseFee, creatorTax] = await publicClient.multicall({
          allowFailure: false,
          contracts: [
            { address: curveAddress, abi: curveFeeAbi, functionName: "quoteFeeBalance" },
            { address: curveAddress, abi: curveFeeAbi, functionName: "creatorTaxBalance" },
          ],
        });
        setPendingFees(baseFee + creatorTax);
      } else if (claimMode === "pool") {
        if (!/^0x[0-9a-fA-F]{64}$/.test(poolId))
          throw new Error("Pool ID must be bytes32 (0x plus 64 hex characters).");
        const [baseFee, creatorTax] = await publicClient.multicall({
          allowFailure: false,
          contracts: [
            { address: contracts.ponsMemeHook, abi: hookFeeAbi, functionName: "pendingFees", args: [poolId as Hash, zeroAddress] },
            { address: contracts.ponsMemeHook, abi: hookFeeAbi, functionName: "pendingCreatorTax", args: [poolId as Hash, zeroAddress] },
          ],
        });
        setPendingFees(baseFee + creatorTax);
      } else {
        setPendingFees(claimable);
      }
    } catch (error) {
      setPendingFees(null);
      toast.error(error instanceof Error ? error.message : "Failed to read pending fees");
    } finally {
      setLoading(null);
    }
  };

  const claimAndBuy = async () => {
    if (!isConnected || !account) return open();
    if (!adapterReady) return toast.error("Adapter is not configured.");
    if (!isAdapterOwner)
      return toast.error("Only the adapter owner can set slippage and run the swap.");
    if (!minRblxOut || Number(minRblxOut) <= 0)
      return toast.error(`Enter the minimum ${ROBUX_TICKER} to receive for slippage protection.`);
    if (claimMode === "escrow" && claimable === BigInt(0))
      return toast.error("No ETH is ready to claim from escrow yet.");
    if (claimMode === "curve" && !isAddress(curveAddress))
      return toast.error("Invalid curve address.");
    if (claimMode === "pool" && !/^0x[0-9a-fA-F]{64}$/.test(poolId))
      return toast.error("Invalid pool ID.");

    setLoading("claim");
    try {
      await ensureChain();
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
      const amountOutMinimum = parseUnits(minRblxOut, 18);
      const hash =
        claimMode === "curve"
          ? await writeContractAsync({
              chainId: CHAIN_ID,
              address: contracts.claimAdapter,
              abi: adapterAbi,
              functionName: "sweepCurveClaimAndBuy",
              args: [curveAddress as Address, BigInt(0), amountOutMinimum, deadline],
            })
          : claimMode === "pool"
            ? await writeContractAsync({
                chainId: CHAIN_ID,
                address: contracts.claimAdapter,
                abi: adapterAbi,
                functionName: "sweepPoolClaimAndBuy",
                args: [poolId as Hash, BigInt(0), BigInt(0), amountOutMinimum, deadline],
              })
            : await writeContractAsync({
                chainId: CHAIN_ID,
                address: contracts.claimAdapter,
                abi: adapterAbi,
                functionName: "claimAndBuy",
                args: [amountOutMinimum, deadline],
              });
      setLastHash(hash);
      toast.success("Transaction submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      await refreshWalletState(account);
      setPendingFees(null);
      toast.success(`Fees converted into ${ROBUX_NAME}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Claim failed";
      toast.error(
        message.includes("InternalSwapRequiresOperator")
          ? "This sweep needs a Pons operator because of an internal swap or buyback. Wait for the operator to sweep fees, then use Escrow mode."
          : message.slice(0, 160),
      );
    } finally {
      setLoading(null);
    }
  };

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const walletLabel = account ? shorten(account) : "Connect wallet";

  const feedPage = (
    <section className="page feed-page container">
      <div className="feed-head">
        <div>
          <div className="eyebrow"><span /> <Radio size={13} /> Live feed</div>
          <h2>Fresh launches.</h2>
          <p className="feed-intro">Coins launched through this interface, paired with ETH and looping fees into {ROBUX_TICKER}.</p>
        </div>
        <div className="feed-toolbar">
          <div className="feed-filters" role="tablist" aria-label="Feed filter">
            {([
              ["all", "All"],
              ["mine", "Mine"],
              ["buyback", "Buyback"],
            ] as [FeedFilter, string][]).map(([key, label]) => (
              <button key={key} className={feedFilter === key ? "active" : ""} onClick={() => setFeedFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <Button className="feed-launch-btn" onClick={() => navigate("launch")}>
            <Rocket size={15} /> Launch a coin
          </Button>
        </div>
      </div>

      {filteredFeed.length === 0 ? (
        <div className="feed-empty">
          <Rocket size={26} />
          <strong>{feedFilter === "all" ? "No launches yet" : "Nothing here yet"}</strong>
          <p>
            {feedFilter === "mine"
              ? "Coins you launch from this device show up here."
              : "Be the first to ship a token. Every launch made through this interface appears here instantly."}
          </p>
          <button className="text-link" onClick={() => navigate("launch")}>Launch a coin <ArrowRight size={16} /></button>
        </div>
      ) : (
        <div className="feed-grid">
          {filteredFeed.map((record) => (
            <FeedCard key={record.id} record={record} />
          ))}
        </div>
      )}
    </section>
  );

  const launchPage = (
    <section className="page container">
      <div className="page-head">
        <button className="page-back" onClick={() => navigate("feed")}><ArrowLeft size={15} /> Feed</button>
        <div className="eyebrow"><span /> Launch console</div>
        <h1 className="page-title">Launch a coin.</h1>
        <p className="page-sub">Create a token on Pons V2 with a native ETH pair. Creator fees route to your dedicated adapter so they can be looped into {ROBUX_TICKER}.</p>
      </div>

      <div className="page-narrow">
        <div className="launch-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow"><span /> Token details</div>
              <h2>Prepare your token.</h2>
            </div>
            <StatusPill ready={adapterReady} />
          </div>

          <div className="form-grid">
            <label className="field"><span>Token name</span><input value={form.name} onChange={(event) => setField("name", event.target.value)} placeholder="Block Party" /></label>
            <label className="field"><span>Ticker</span><input value={form.symbol} onChange={(event) => setField("symbol", event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10))} placeholder="BLOCK" /></label>
            <label className="field field-wide"><span>Description</span><textarea value={form.description} onChange={(event) => setField("description", event.target.value)} placeholder="Tell people why this launch is worth following…" rows={4} /></label>
            <label className="field"><span>Logo URL / IPFS</span><input value={form.logo} onChange={(event) => setField("logo", event.target.value)} placeholder="ipfs://…" /></label>
            <label className="field"><span>Website</span><input value={form.website} onChange={(event) => setField("website", event.target.value)} placeholder="https://…" /></label>
            <label className="field"><span>X / Twitter</span><input value={form.twitter} onChange={(event) => setField("twitter", event.target.value)} placeholder="https://x.com/…" /></label>
            <label className="field">
              <span>Creator tax</span>
              <select value={form.creatorTax} onChange={(event) => setField("creatorTax", event.target.value)}>
                <option value="0">0.00%</option><option value="50">0.50%</option><option value="100">1.00%</option><option value="200">2.00%</option>
              </select>
            </label>
            <label className="field field-wide"><span>Pons configuration</span>
              <select value={selectedConfig.toString()} onChange={(event) => setSelectedConfig(BigInt(event.target.value))} disabled={configs.length === 0}>
                {configs.length === 0 && <option value="0">Not read from chain yet</option>}
                {configs.map((config) => <option key={config.id.toString()} value={config.id.toString()}>Config #{config.id.toString()} · threshold {formatEth(config.graduationThreshold)} ETH</option>)}
              </select>
            </label>
            <label className="toggle-row field-wide">
              <button type="button" role="switch" aria-checked={form.buybackEnabled} className={`toggle ${form.buybackEnabled ? "toggle-on" : ""}`} onClick={() => setField("buybackEnabled", !form.buybackEnabled)}><span /></button>
              <span><strong>Enable native Pons buyback</strong><small>Optional and separate from the external {ROBUX_TICKER} auto buy.</small></span>
            </label>
          </div>

          <div className="launch-summary">
            <div><span>Pair</span><strong>Native ETH</strong></div>
            <div><span>Recipient</span><strong>{adapterReady ? shorten(contracts.claimAdapter) : "No adapter yet"}</strong></div>
            <div><span>Launch fee</span><strong>{formatEth(launchFee)} ETH</strong></div>
            <div><span>Eligibility</span><strong className={canLaunch === false ? "text-amber-300" : "text-lime-300"}>{canLaunch === null ? "Connect wallet" : canLaunch ? "Eligible" : "Whitelist required"}</strong></div>
          </div>

          <Button className="launch-button" onClick={launch} disabled={loading === "launch" || configs.length === 0 || (adapterReady && !adapterOwner) || Boolean(account && adapterOwner && !isAdapterOwner)}>
            {loading === "launch" ? <LoaderCircle className="animate-spin" size={18} /> : <Rocket size={18} />}
            {account ? "Launch with ETH pair" : "Connect to launch"}
            <ArrowRight size={18} />
          </Button>
          <p className="fineprint">Use one adapter per launch and treasury. Your wallet signs directly to Pons V2; this app never asks for a private key.</p>
        </div>

        <div className="page-crosslink">
          <span>Already launched and fees are piling up?</span>
          <button className="text-link" onClick={() => navigate("claim")}>Go to Claim fees <ArrowRight size={15} /></button>
        </div>
      </div>
    </section>
  );

  const claimPage = (
    <section className="page container">
      <div className="page-head">
        <button className="page-back" onClick={() => navigate("feed")}><ArrowLeft size={15} /> Feed</button>
        <div className="eyebrow"><span /> Auto buy engine</div>
        <h1 className="page-title">Claim fees into {ROBUX_NAME}.</h1>
        <p className="page-sub">Sweep and claim the ETH creator fees your adapter has accrued, then swap them into {ROBUX_TICKER} in one atomic, slippage protected transaction.</p>
      </div>

      <div className="page-claim">
        <aside className="claim-panel">
          <div className="claim-top">
            <div className="claim-icon"><Zap size={23} /></div>
            <div><span>AUTO BUY ENGINE</span><h3>Claim fees into {ROBUX_NAME}</h3></div>
          </div>
          <div className="balance-card">
            <span>ETH ready to claim</span>
            <strong>{formatEth(claimable)}</strong>
            <small>in the Pons Fee Escrow</small>
          </div>
          <div className="claim-modes" role="tablist" aria-label="Fee source">
            {(["escrow", "curve", "pool"] as ClaimMode[]).map((mode) => (
              <button key={mode} type="button" className={claimMode === mode ? "active" : ""} onClick={() => { setClaimMode(mode); setPendingFees(null); }}>
                {mode === "escrow" ? "Escrow" : mode === "curve" ? "Curve" : "Pool V4"}
              </button>
            ))}
          </div>
          {claimMode === "curve" && (
            <label className="field dark-field"><span>Bonding curve address</span><input value={curveAddress} onChange={(event) => setCurveAddress(event.target.value)} placeholder="0x…" /></label>
          )}
          {claimMode === "pool" && (
            <label className="field dark-field"><span>Pons / Uniswap V4 pool ID</span><input value={poolId} onChange={(event) => setPoolId(event.target.value)} placeholder="0x plus 64 hex characters" /></label>
          )}
          {claimMode !== "escrow" && (
            <button className="pending-button" type="button" onClick={readPendingFees} disabled={loading === "fees"}>
              {loading === "fees" ? <LoaderCircle className="animate-spin" size={14} /> : <Network size={14} />}
              {pendingFees === null ? "Read unswept fees" : `${formatEth(pendingFees)} ETH pending`}
            </button>
          )}
          <label className="field dark-field"><span>Minimum {ROBUX_TICKER} received</span><input inputMode="decimal" value={minRblxOut} onChange={(event) => setMinRblxOut(event.target.value)} placeholder="Required for slippage protection" /></label>
          <Button className="claim-button" onClick={claimAndBuy} disabled={loading === "claim" || !adapterReady}>
            {loading === "claim" ? <LoaderCircle className="animate-spin" size={18} /> : <Zap size={18} />}
            {claimMode === "escrow" ? `Claim & buy ${ROBUX_TICKER}` : `Sweep, claim & buy`}
          </Button>
          <div className="claim-checks">
            <span><Check size={14} /> Owner gated execution</span>
            <span><Check size={14} /> Single atomic transaction</span>
            <span><Check size={14} /> 20 minute deadline</span>
            <span><Check size={14} /> Onchain minimum output</span>
          </div>
          {claimMode !== "escrow" && <p className="operator-note">If the sweep needs an internal Pons swap or buyback, the creator transaction reverts. Wait for the Pons operator, then use Escrow mode.</p>}
          {lastHash && <a className="tx-link" href={explorerTx(lastHash)} target="_blank" rel="noreferrer">View latest transaction <ExternalLink size={14} /></a>}
        </aside>

        <div className="page-crosslink">
          <span>Need to create a token first?</span>
          <button className="text-link" onClick={() => navigate("launch")}>Go to Launch a coin <ArrowRight size={15} /></button>
        </div>
      </div>
    </section>
  );

  const howPage = (
    <section className="page container">
      <div className="page-head">
        <button className="page-back" onClick={() => navigate("feed")}><ArrowLeft size={15} /> Feed</button>
        <div className="eyebrow"><span /> How it works</div>
        <h1 className="page-title">One loop. Same ETH pair.</h1>
        <p className="page-sub">Pons still prices the curve, graduation, and fees in ETH. The only thing that changes is the creator fee recipient: an adapter smart contract instead of a plain wallet.</p>
      </div>

      <div className="flow-grid">
        {[
          { n: "01", icon: Rocket, title: "Launch on Pons", text: "The token is created with a native ETH pair and creatorFeeRecipient pointed at this launch's dedicated adapter." },
          { n: "02", icon: Fuel, title: "Fees accrue", text: "Trading fees and creator tax are swept into the native ETH ledger the adapter holds in the Pons escrow." },
          { n: "03", icon: Sparkles, title: "Claim and buy", text: `The adapter owner triggers the claim. The adapter swaps ETH into ${ROBUX_TICKER} with a minimum output and deadline.` },
          { n: "04", icon: Box, title: "Into the treasury", text: `The resulting ${ROBUX_TICKER} is sent straight to the treasury. The adapter holds no balance once the transaction settles.` },
        ].map((item, index) => (
          <article className="flow-card" key={item.n} style={{ animationDelay: `${index * 60}ms` }}>
            <div className="flow-meta"><span>{item.n}</span><item.icon size={19} /></div>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            {index < 3 && <ArrowRight className="flow-arrow" size={18} />}
          </article>
        ))}
      </div>

      <div className="safety-block">
        <div className="safety-kicker"><BadgeCheck size={19} /> Built for transparent execution</div>
        <h2>The route is automated. The decision is not.</h2>
        <p>Every launch, claim, and swap still requires a wallet signature. No bots with private keys, no custody, and no hidden minimum price.</p>
        <Button className="feed-launch-btn" onClick={() => navigate("launch")}><Rocket size={15} /> Launch a coin</Button>
      </div>
    </section>
  );

  const contractsPage = (
    <section className="page container">
      <div className="page-head">
        <button className="page-back" onClick={() => navigate("feed")}><ArrowLeft size={15} /> Feed</button>
        <div className="eyebrow"><span /> Verify it yourself</div>
        <h1 className="page-title">Addresses, not promises.</h1>
        <p className="page-sub">Every value path is verifiable through the explorer. The target token is configurable so it is never confused with the official Roblox stock token.</p>
      </div>

      <div className="contracts-grid">
        <div className="contract-list">
          <AddressRow label="Pons V2 Factory" address={contracts.ponsFactory} />
          <AddressRow label="Pons Fee Escrow" address={contracts.ponsFeeEscrow} />
          <AddressRow label="Pons Meme Hook" address={contracts.ponsMemeHook} />
          <AddressRow label="Claim Adapter" address={contracts.claimAdapter} />
          <AddressRow label="Target Robux (default)" address={contracts.targetToken} />
          <AddressRow label="Official Roblox token" address={contracts.officialRobloxToken} />
          <AddressRow label="Uniswap SwapRouter02" address={contracts.uniswapRouter} />
        </div>
        <div className="warning-box"><CircleAlert size={19} /><div><strong>Two different tokens share the RBLX symbol.</strong><p>The current default target is the community <b>Robux</b> token at <code>0xac3D…cb07</code>. The official <b>Roblox · Robinhood Token</b> is at <code>0xF0C4…1bE8</code>. Confirm the target before deploying an adapter.</p></div></div>
      </div>
    </section>
  );

  return (
    <div className="site-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("feed")} aria-label="Robux Loop home">
          <img className="brand-icon" src="/images/robux-loop-icon.webp" alt="" />
          <span>ROBUX<span className="brand-accent">/LOOP</span></span>
        </button>
        <div className="topbar-actions">
          <Button className="launch-cta-btn" onClick={() => navigate("launch")}>
            <Rocket size={15} /> Launch a coin
          </Button>
          <Button className="wallet-button" onClick={() => open()}>
            <Wallet size={16} />
            <span className="wallet-label">{walletLabel}</span>
          </Button>
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <MenuIcon size={19} />
          </button>
        </div>
      </header>

      <div className={`drawer-overlay ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)} aria-hidden={!menuOpen}>
        <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Menu">
          <div className="drawer-head">
            <span>Menu</span>
            <button className="drawer-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
          <nav className="drawer-nav">
            {MENU_LINKS.map((link) => (
              <button key={link.view} className={view === link.view ? "active" : ""} onClick={() => navigate(link.view)}>
                <link.icon size={17} />
                {link.label}
                <ArrowRight size={15} className="drawer-arrow" />
              </button>
            ))}
            <a href="https://docs.ponsfamily.com/v2" target="_blank" rel="noreferrer">
              <FileText size={17} /> Docs <ArrowUpRight size={15} className="drawer-arrow" />
            </a>
          </nav>
          <div className="drawer-foot">
            <a className="drawer-social" href="https://x.com" target="_blank" rel="noreferrer">Follow updates on X</a>
            <Button className="drawer-launch" onClick={() => navigate("launch")}>
              <Rocket size={16} /> Launch a coin
            </Button>
            <Button className="drawer-wallet" onClick={() => { setMenuOpen(false); open(); }}>
              <Wallet size={16} /> {walletLabel}
            </Button>
          </div>
        </aside>
      </div>

      <main id="top">
        {view === "feed" && feedPage}
        {view === "launch" && launchPage}
        {view === "claim" && claimPage}
        {view === "how" && howPage}
        {view === "contracts" && contractsPage}
      </main>

      <footer className="footer container">
        <button className="brand" onClick={() => navigate("feed")}><img className="brand-icon" src="/images/robux-loop-icon.webp" alt="" /><span>ROBUX<span className="brand-accent">/LOOP</span></span></button>
        <p>Independent interface for Pons V2 on Robinhood Chain. Not affiliated with Roblox Corporation, Robinhood Markets, Pons, or Uniswap. R$ denotes the {ROBUX_TICKER} target token, not fiat.</p>
        <a href="https://docs.ponsfamily.com/v2" target="_blank" rel="noreferrer">Pons docs <ExternalLink size={13} /></a>
      </footer>
    </div>
  );
}
