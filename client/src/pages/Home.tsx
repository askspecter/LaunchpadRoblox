import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Box,
  Check,
  CircleAlert,
  Coins,
  Copy,
  ExternalLink,
  Fuel,
  Gift,
  Globe,
  HelpCircle,
  ImagePlus,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  Lock,
  Menu as MenuIcon,
  Network,
  Radio,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  isAddress,
  isAddressEqual,
  parseEther,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import {
  useAccount,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
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
  pairTokenSymbol,
  publicClient,
  readWithRetry,
  robinhoodChain,
  type LaunchConfig,
} from "@/lib/web3";
import {
  addLaunch,
  getLaunchFeed,
  removeLaunch,
  subscribeFeed,
  timeAgo,
  type LaunchRecord,
} from "@/lib/feed";
import { formatEth, ROBUX_SYMBOL, ROBUX_NAME, ROBUX_TICKER } from "@/lib/robux";
import {
  STORE_PACKS,
  deriveCode,
  getOrders,
  packTotalRobux,
  recordOrder,
  redeemCode,
  subscribeOrders,
  type StoreOrder,
  type StorePack,
} from "@/lib/store";

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
type View = "feed" | "store" | "launch" | "claim" | "how" | "contracts" | "docs";

const CHAIN_ID = 4663;

// The pair/quote asset every launch is denominated in. Zero address = native
// ETH; otherwise the configured token (RBLX by default).
const PAIR_IS_ETH = isAddressEqual(contracts.pairToken, zeroAddress);
const PAIR_LABEL = PAIR_IS_ETH ? "ETH" : pairTokenSymbol;

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
  { view: "store", label: "Robux store", icon: ShoppingBag },
  { view: "launch", label: "Launch a coin", icon: Rocket },
  { view: "claim", label: "Claim fees", icon: Zap },
  { view: "how", label: "How it works", icon: Sparkles },
  { view: "docs", label: "Docs", icon: BookOpen },
  { view: "contracts", label: "Contracts", icon: ShieldCheck },
];

const viewFromHash = (): View => {
  const h = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#\/?/, "");
  return h === "store" || h === "launch" || h === "claim" || h === "how" || h === "contracts" || h === "docs"
    ? h
    : "feed";
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
        <button
          className="feed-remove"
          aria-label="Remove from feed"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Remove ${record.name} from your local feed?`)) {
              removeLaunch(record.id);
              toast.success("Removed from feed");
            }
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="feed-body">
        <div className="feed-heading">
          <strong title={record.name}>{record.name}</strong>
          <span>${ticker}</span>
        </div>
        <div className="feed-subline">
          <span className="feed-pair">{PAIR_LABEL} pair</span>
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
  const { sendTransactionAsync } = useSendTransaction();
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
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [protocolError, setProtocolError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<Hash | null>(null);
  const [feed, setFeed] = useState<LaunchRecord[]>([]);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");

  // Store state
  const [selectedPack, setSelectedPack] = useState<string>("plus");
  const [buying, setBuying] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<StoreOrder | null>(null);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemStatus, setRedeemStatus] = useState<
    { kind: "ok"; order: StoreOrder } | { kind: "error"; message: string } | null
  >(null);

  const storeReady = !isAddressEqual(contracts.storeTreasury, zeroAddress);

  const adapterReady = !isAddressEqual(contracts.claimAdapter, zeroAddress);
  const isAdapterOwner = Boolean(
    account && adapterOwner && isAddressEqual(account, adapterOwner),
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
    setOrders(getOrders());
    return subscribeOrders(setOrders);
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
    setLoadingConfigs(true);
    try {
      // Read the config count and the configs themselves with retry. These are
      // what gate the launch button, so they must not be aborted by a single
      // 429 from the public RPC.
      const count = await readWithRetry(() =>
        publicClient.readContract({
          address: contracts.ponsFactory,
          abi: factoryAbi,
          functionName: "launchConfigCount",
        }),
      );

      // Read each config with an individual call rather than one multicall.
      // Single reads succeed on this RPC where the batched multicall can fail
      // in the browser, which is what left the config "not read from chain".
      const records = await Promise.all(
        Array.from({ length: Number(count) }, (_, index) =>
          readWithRetry(() =>
            publicClient.readContract({
              address: contracts.ponsFactory,
              abi: factoryAbi,
              functionName: "getLaunchConfig",
              args: [BigInt(index)],
            }),
          ),
        ),
      );

      const open = records
        .map((record, index) => ({ id: BigInt(index), ...record }))
        .filter((record) => record.enabled) as LaunchConfig[];

      setConfigs(open);
      setProtocolError(
        open.length === 0 ? "No open Pons launch configuration is enabled on chain right now." : null,
      );
      if (open.length > 0)
        setSelectedConfig((current) =>
          open.some((item) => item.id === current) ? current : open[0].id,
        );

      // The launch fee is non-critical for enabling the button, so a failure
      // here must not clear the configs we already loaded.
      try {
        const fee = await readWithRetry(() =>
          publicClient.readContract({
            address: contracts.ponsFactory,
            abi: factoryAbi,
            functionName: "launchFee",
          }),
        );
        setLaunchFee(fee);
      } catch {
        /* keep the last known launch fee */
      }
    } catch {
      // Surface the failure with a Retry affordance instead of leaving the
      // launch button silently disabled.
      setProtocolError(
        "Couldn't read the Pons launch config — the public RPC may be rate limited. Retry, or set VITE_ROBINHOOD_RPC_URL to a dedicated endpoint.",
      );
    } finally {
      setLoadingConfigs(false);
    }
  }, []);

  const refreshWalletState = useCallback(
    async (wallet?: Address | null) => {
      const activeAccount = wallet ?? account;
      try {
        const reads: Promise<unknown>[] = [];
        if (adapterReady) {
          reads.push(
            readWithRetry(() =>
              publicClient.readContract({
                address: contracts.ponsFeeEscrow,
                abi: escrowAbi,
                functionName: "balanceOf",
                args: [contracts.claimAdapter],
              }),
            ),
          );
          reads.push(
            readWithRetry(() =>
              publicClient.readContract({
                address: contracts.claimAdapter,
                abi: adapterAbi,
                functionName: "owner",
              }),
            ),
          );
        }
        if (activeAccount) {
          reads.push(
            readWithRetry(() =>
              publicClient.readContract({
                address: contracts.ponsFactory,
                abi: factoryAbi,
                functionName: "canLaunch",
                args: [activeAccount],
              }),
            ),
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
    // The RBLX auto-buy adapter is optional. When it is configured, only its
    // owner may launch into it; when it is not, creator fees route to the
    // connected wallet as native ETH (collect ETH, deliver Robux manually).
    if (adapterReady) {
      if (!adapterOwner)
        return toast.error("Adapter owner could not be verified onchain yet.");
      if (!isAdapterOwner)
        return toast.error("This wallet is not the adapter owner. Use the adapter dedicated to this launch.");
    }
    if (!form.name.trim() || !form.symbol.trim() || !form.description.trim())
      return toast.error("Name, ticker, and description are required.");
    if (canLaunch === false)
      return toast.error("This address is not yet allowed to launch on Pons V2.");

    const creatorFeeRecipient = adapterReady ? contracts.claimAdapter : account;

    setLoading("launch");
    try {
      await ensureChain();
      // Read the economics preview and the current launch fee live, with retry,
      // so a rate-limited earlier read can never block an otherwise valid
      // launch. previewLaunchEconomics also validates the selected config.
      const [expectedEconomics, fee] = await Promise.all([
        readWithRetry(() =>
          publicClient.readContract({
            address: contracts.ponsFactory,
            abi: factoryAbi,
            functionName: "previewLaunchEconomics",
            args: [selectedConfig, contracts.pairToken],
          }),
        ),
        readWithRetry(() =>
          publicClient.readContract({
            address: contracts.ponsFactory,
            abi: factoryAbi,
            functionName: "launchFee",
          }),
        ).catch(() => launchFee),
      ]);
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
            creatorFeeRecipient,
            creatorTaxBps,
            buybackEnabled: form.buybackEnabled,
            expectedEconomics,
            salt,
          },
          selectedConfig,
          contracts.pairToken,
        ],
        value: fee,
      });
      setLastHash(hash);
      toast.success("Launch submitted. Waiting for confirmation…");
      // Only record the launch once the transaction actually confirms on chain.
      // A submitted tx can still revert; adding to the feed on submission alone
      // is what put failed launches in the feed.
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        return toast.error("Launch reverted on chain — nothing was added to the feed.");
      }
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
      toast.success("Launch confirmed. Added to the live feed.");
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
        const [baseFee, creatorTax] = await Promise.all([
          readWithRetry(() => publicClient.readContract({ address: curveAddress, abi: curveFeeAbi, functionName: "quoteFeeBalance" })),
          readWithRetry(() => publicClient.readContract({ address: curveAddress, abi: curveFeeAbi, functionName: "creatorTaxBalance" })),
        ]);
        setPendingFees(baseFee + creatorTax);
      } else if (claimMode === "pool") {
        if (!/^0x[0-9a-fA-F]{64}$/.test(poolId))
          throw new Error("Pool ID must be bytes32 (0x plus 64 hex characters).");
        const [baseFee, creatorTax] = await Promise.all([
          readWithRetry(() => publicClient.readContract({ address: contracts.ponsMemeHook, abi: hookFeeAbi, functionName: "pendingFees", args: [poolId as Hash, zeroAddress] })),
          readWithRetry(() => publicClient.readContract({ address: contracts.ponsMemeHook, abi: hookFeeAbi, functionName: "pendingCreatorTax", args: [poolId as Hash, zeroAddress] })),
        ]);
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

  const buyPack = async (pack: StorePack) => {
    if (!isConnected || !account) return open();
    if (!storeReady)
      return toast.error("Store is not configured. Set VITE_STORE_TREASURY_ADDRESS.");

    setBuying(pack.id);
    setLastOrder(null);
    try {
      await ensureChain();
      const hash = await sendTransactionAsync({
        chainId: CHAIN_ID,
        to: contracts.storeTreasury,
        value: parseEther(pack.priceEth),
      });
      toast.success("Payment submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      // The redeem code is derived from the confirmed payment hash, so it is a
      // verifiable pointer back to this exact on-chain payment.
      const order = recordOrder({
        packId: pack.id,
        robux: packTotalRobux(pack),
        priceEth: pack.priceEth,
        code: deriveCode(hash, pack.id),
        txHash: hash,
        buyer: account,
      });
      setLastOrder(order);
      setLastHash(hash);
      toast.success("Paid in ETH — your order code is ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 160) : "Payment failed");
    } finally {
      setBuying(null);
    }
  };

  const runRedeem = () => {
    const result = redeemCode(redeemInput);
    if (result.ok) {
      setRedeemStatus({ kind: "ok", order: result.order });
      setRedeemInput("");
      toast.success(`Order for ${result.order.robux.toLocaleString()} Robux marked fulfilled`);
      return;
    }
    const message =
      result.reason === "format"
        ? "That code is not in the right format."
        : result.reason === "already"
          ? "This order has already been marked fulfilled."
          : "No order on this device matches that code.";
    setRedeemStatus({ kind: "error", message });
    toast.error(message);
  };

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const logoInputRef = useRef<HTMLInputElement>(null);

  // Read an uploaded image and downscale it to a compact data URL so it can be
  // stored with the launch and shown on the feed card without needing a link.
  const onLogoFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image file.");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image is too large (max 8 MB).");
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        let { width, height } = img;
        if (width >= height && width > max) {
          height = Math.round((height * max) / width);
          width = max;
        } else if (height > max) {
          width = Math.round((width * max) / height);
          height = max;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return setField("logo", reader.result as string);
        ctx.drawImage(img, 0, 0, width, height);
        const transparent = /image\/(png|gif|webp|svg)/.test(file.type);
        setField("logo", canvas.toDataURL(transparent ? "image/png" : "image/jpeg", 0.82));
      };
      img.onerror = () => toast.error("Could not read that image.");
      img.src = reader.result as string;
    };
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsDataURL(file);
  };

  const walletLabel = account ? shorten(account) : "Connect wallet";

  const feedPage = (
    <section className="page feed-page container">
      <div className="feed-head">
        <div>
          <div className="eyebrow"><span /> <Radio size={13} /> Live feed</div>
          <h2>Fresh launches.</h2>
          <p className="feed-intro">Coins launched through this interface, paired with {PAIR_LABEL} so creator fees accrue in {PAIR_LABEL}.</p>
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

  const storePage = (
    <section className="page container">
      <div className="page-head">
        <button className="page-back" onClick={() => navigate("feed")}><ArrowLeft size={15} /> Feed</button>
        <div className="eyebrow"><span /> <ShoppingBag size={13} /> Robux store</div>
        <h1 className="page-title">Buy Robux with ETH.</h1>
        <p className="page-sub">Pick a pack and pay with native ETH from your own wallet. The moment the payment confirms you get an order code bound to that transaction — your proof of purchase. The store operator then delivers your {ROBUX_NAME} manually.</p>
      </div>

      <div className="store-notice">
        <ShieldCheck size={18} />
        <p><strong>How delivery works.</strong> Robux is <b>delivered manually by the store operator</b> after your ETH payment confirms. Bloxpad the software does not mint, hold, or guarantee Robux, and does <b>not</b> auto-convert crypto into Robux. Bloxpad is not affiliated with Roblox Corporation. Your wallet signs the payment; the app never holds a private key. Only buy if you trust the operator to fulfil your order.</p>
      </div>

      <div className="store-grid">
        {STORE_PACKS.map((pack) => {
          const total = packTotalRobux(pack);
          const active = selectedPack === pack.id;
          return (
            <article
              key={pack.id}
              className={`pack-card ${active ? "pack-active" : ""} ${pack.popular ? "pack-popular" : ""}`}
              onClick={() => setSelectedPack(pack.id)}
            >
              {pack.popular && <span className="pack-flag">{pack.tagline}</span>}
              <div className="pack-amount"><span className="pack-symbol">{ROBUX_SYMBOL}</span>{total.toLocaleString()}</div>
              <div className="pack-sub">Robux · delivered manually{pack.bonusPct ? ` · +${pack.bonusPct}% bonus` : ""}</div>
              <div className="pack-price"><Fuel size={13} /> {pack.priceEth} ETH</div>
              <Button
                className="pack-buy"
                onClick={(e) => { e.stopPropagation(); buyPack(pack); }}
                disabled={buying !== null || !storeReady}
              >
                {buying === pack.id ? <LoaderCircle className="animate-spin" size={16} /> : <ShoppingBag size={16} />}
                {account ? "Pay with ETH" : "Connect to buy"}
              </Button>
              {!pack.popular && <span className="pack-tagline">{pack.tagline}</span>}
            </article>
          );
        })}
      </div>

      {!storeReady && (
        <p className="store-config-warn"><CircleAlert size={14} /> Store treasury is not configured yet. Set <code>VITE_STORE_TREASURY_ADDRESS</code> to the wallet that fulfils codes.</p>
      )}

      {lastOrder && (
        <div className="code-card">
          <div className="code-card-head"><Ticket size={18} /> Your order code</div>
          <p className="code-card-sub">Keep this code as proof of purchase and send it to the operator. Your {lastOrder.robux.toLocaleString()} Robux is delivered manually after payment.</p>
          <div className="code-value">
            <code>{lastOrder.code}</code>
            <button
              className="code-copy"
              onClick={async () => { await navigator.clipboard.writeText(lastOrder.code); toast.success("Code copied"); }}
            >
              <Copy size={15} /> Copy
            </button>
          </div>
          <a className="tx-link" href={explorerTx(lastOrder.txHash)} target="_blank" rel="noreferrer">
            View the payment on the explorer <ExternalLink size={14} />
          </a>
        </div>
      )}

      <div className="redeem-block">
        <div className="redeem-panel">
          <div className="redeem-head"><KeyRound size={18} /> Operator: fulfil an order</div>
          <p className="redeem-sub">Once you have sent the Robux, paste the order code to mark it delivered.</p>
          <div className="redeem-row">
            <input
              value={redeemInput}
              onChange={(e) => { setRedeemInput(e.target.value); setRedeemStatus(null); }}
              placeholder="BLOX-XXXX-XXXX-XXXX-XXXX"
              spellCheck={false}
            />
            <Button className="redeem-btn" onClick={runRedeem} disabled={!redeemInput.trim()}>
              <Gift size={16} /> Mark fulfilled
            </Button>
          </div>
          {redeemStatus?.kind === "ok" && (
            <div className="redeem-result redeem-ok">
              <Check size={15} /> Order for {redeemStatus.order.robux.toLocaleString()} Robux marked fulfilled — buyer wallet {shorten(redeemStatus.order.buyer, 4)}.
            </div>
          )}
          {redeemStatus?.kind === "error" && (
            <div className="redeem-result redeem-err"><CircleAlert size={15} /> {redeemStatus.message}</div>
          )}
        </div>

        <div className="orders-panel">
          <div className="orders-head"><Ticket size={15} /> My orders <span>{orders.length}</span></div>
          {orders.length === 0 ? (
            <p className="orders-empty">Orders you buy on this device show up here.</p>
          ) : (
            <ul className="orders-list">
              {orders.slice(0, 8).map((order) => (
                <li key={order.id} className="order-row">
                  <div>
                    <strong>{ROBUX_SYMBOL}{order.robux.toLocaleString()}</strong>
                    <code>{order.code}</code>
                  </div>
                  <div className="order-meta">
                    <span className={order.status === "redeemed" ? "order-redeemed" : "order-active"}>
                      {order.status === "redeemed" ? "Fulfilled" : "Awaiting"}
                    </span>
                    <a href={explorerTx(order.txHash)} target="_blank" rel="noreferrer" aria-label="View payment"><ExternalLink size={13} /></a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="page-crosslink">
        <span>Want to launch your own coin?</span>
        <button className="text-link" onClick={() => navigate("launch")}>Go to Launch <ArrowRight size={15} /></button>
      </div>
    </section>
  );

  const launchPage = (
    <section className="page container">
      <div className="page-head">
        <button className="page-back" onClick={() => navigate("feed")}><ArrowLeft size={15} /> Feed</button>
        <div className="eyebrow"><span /> Launch console</div>
        <h1 className="page-title">Launch a coin.</h1>
        <p className="page-sub">Create a token on Pons V2 paired with {PAIR_LABEL}. Creator fees accrue in {PAIR_LABEL} to your wallet — you then deliver Robux to buyers yourself with a redeem code.</p>
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
            <div className="field field-logo"><span>Logo image</span>
              {form.logo ? (
                <div className="logo-preview">
                  <img src={form.logo} alt="Logo preview" />
                  <div className="logo-preview-actions">
                    <button type="button" onClick={() => logoInputRef.current?.click()}>Change</button>
                    <button type="button" onClick={() => setField("logo", "")}>Remove</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="logo-dropzone" onClick={() => logoInputRef.current?.click()}>
                  <ImagePlus size={18} />
                  <strong>Add image</strong>
                  <small>PNG, JPG, GIF · uploaded directly</small>
                </button>
              )}
              <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={(event) => { onLogoFile(event.target.files?.[0]); event.target.value = ""; }} />
            </div>
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
            <div><span>Pair</span><strong>{PAIR_IS_ETH ? "Native ETH" : PAIR_LABEL}</strong></div>
            <div><span>Fees to</span><strong>{adapterReady ? `${ROBUX_TICKER} adapter` : account ? `Your wallet (${PAIR_LABEL})` : "Your wallet"}</strong></div>
            <div><span>Launch fee</span><strong>{formatEth(launchFee)} ETH</strong></div>
            <div><span>Eligibility</span><strong className={canLaunch === false ? "text-amber-300" : "text-orange-300"}>{canLaunch === null ? "Connect wallet" : canLaunch ? "Eligible" : "Whitelist required"}</strong></div>
          </div>

          {(protocolError || loadingConfigs) && (
            <div className="config-status">
              {loadingConfigs ? (
                <span className="config-loading"><LoaderCircle className="animate-spin" size={14} /> Reading Pons launch config…</span>
              ) : (
                <>
                  <span><CircleAlert size={14} /> {protocolError}</span>
                  <button type="button" onClick={refreshProtocol}>Retry</button>
                </>
              )}
            </div>
          )}

          <Button className="launch-button" onClick={launch} disabled={loading === "launch"}>
            {loading === "launch" ? <LoaderCircle className="animate-spin" size={18} /> : <Rocket size={18} />}
            Launch
            <ArrowRight size={18} />
          </Button>
          <p className="fineprint">{adapterReady ? `Creator fees route to the ${ROBUX_TICKER} adapter.` : `Creator fees are paid to your wallet in ${PAIR_LABEL} — deliver Robux to buyers yourself.`} Your wallet signs directly to Pons V2; this app never asks for a private key.</p>
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
        <h1 className="page-title">How the fee loop works.</h1>
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

  const DOC_SECTIONS: { id: string; label: string; icon: typeof BookOpen }[] = [
    { id: "doc-intro", label: "Overview", icon: BookOpen },
    { id: "doc-start", label: "Quickstart", icon: Zap },
    { id: "doc-launch", label: "Launching a coin", icon: Rocket },
    { id: "doc-pair", label: "The RBLX pair", icon: Coins },
    { id: "doc-store", label: "Robux store", icon: ShoppingBag },
    { id: "doc-codes", label: "Redeem codes", icon: KeyRound },
    { id: "doc-safety", label: "Non-custodial safety", icon: Lock },
    { id: "doc-setup", label: "Network & setup", icon: Network },
    { id: "doc-faq", label: "FAQ", icon: HelpCircle },
  ];
  const scrollToDoc = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const docsPage = (
    <section className="page container">
      <div className="page-head">
        <button className="page-back" onClick={() => navigate("feed")}><ArrowLeft size={15} /> Feed</button>
        <div className="eyebrow"><span /> <BookOpen size={13} /> Documentation</div>
        <h1 className="page-title">Bloxpad, end to end.</h1>
        <p className="page-sub">Everything the interface does, in plain language: how a launch works, how the Robux store works, how redeem codes are generated, and exactly where custody does and does not sit.</p>
      </div>

      <div className="docs-layout">
        <aside className="docs-toc">
          <span className="docs-toc-label">On this page</span>
          {DOC_SECTIONS.map((s) => (
            <button key={s.id} onClick={() => scrollToDoc(s.id)}>
              <s.icon size={14} /> {s.label}
            </button>
          ))}
        </aside>

        <div className="docs-main">
          <article id="doc-intro" className="docs-section">
            <h2><BookOpen size={18} /> Overview</h2>
            <p>Bloxpad is a launchpad interface on <b>Robinhood Chain</b> (chain ID 4663). You can launch a token in a single wallet signature, and you can run a Robux store on top of it. It is a front end only: there is no server holding your funds and no private key anywhere in the app.</p>
            <p>The theme is Roblox, but the mechanics are ordinary on-chain mechanics. Bloxpad is an independent project and is <b>not affiliated with Roblox Corporation</b>, Robinhood Markets, or any token issuer. It never mints, holds, or guarantees Roblox in-game currency.</p>
          </article>

          <article id="doc-start" className="docs-section">
            <h2><Zap size={18} /> Quickstart</h2>
            <ol className="docs-steps">
              <li><strong>Connect a wallet.</strong> Use the menu, then pick your wallet through the Reown modal. Make sure it is on Robinhood Chain.</li>
              <li><strong>Launch a coin,</strong> or <strong>open the store.</strong> Launch creates a token paired with {PAIR_LABEL}; the store sells Robux packs for ETH.</li>
              <li><strong>Sign.</strong> Every action is a transaction from your own wallet. Nothing moves until you approve it.</li>
            </ol>
          </article>

          <article id="doc-launch" className="docs-section">
            <h2><Rocket size={18} /> Launching a coin</h2>
            <p>On the <button className="docs-link" onClick={() => navigate("launch")}>Launch</button> page you fill in the token name, ticker, description, logo, and an optional creator tax, then submit. The interface reads the live Pons launch config, pins the economics with <code>previewLaunchEconomics</code>, and sends <code>launchToken</code> from your wallet.</p>
            <p>Creator fees are paid to the recipient you launch with. By default that is <b>your own wallet</b>, so fees arrive as {PAIR_LABEL}. You do not need to deploy any adapter for this.</p>
            <div className="docs-callout"><CircleAlert size={16} /><p>If the launch button ever seems stuck, it is almost always the public RPC being rate limited. Set a dedicated <code>VITE_ROBINHOOD_RPC_URL</code> (see Network &amp; setup) and the reads go through.</p></div>
          </article>

          <article id="doc-pair" className="docs-section">
            <h2><Coins size={18} /> The RBLX pair</h2>
            <p>Every launch is denominated in a <b>pair (quote) asset</b>. Bloxpad is configured to pair with <b>RBLX</b> — the Roblox · Robinhood Token at <code>0xF0C4…1bE8</code> — so the bonding curve, trades, and creator fees are all in RBLX. You receive RBLX directly; there is no ETH-to-RBLX swap step.</p>
            <p>The pair is configurable through <code>VITE_PAIR_TOKEN_ADDRESS</code>. Set it to the zero address to pair with native ETH instead. Always confirm the token has liquidity on the chosen Pons config before relying on it.</p>
          </article>

          <article id="doc-store" className="docs-section">
            <h2><ShoppingBag size={18} /> Robux store</h2>
            <p>The <button className="docs-link" onClick={() => navigate("store")}>Store</button> lets a buyer pay native ETH for a Robux pack. When the payment confirms, the app issues an <b>order code</b> bound to that exact transaction — the buyer's proof of purchase.</p>
            <p><b>Delivery is manual.</b> Bloxpad does not mint, hold, auto-convert, or guarantee Robux. As the operator, you deliver Robux to the buyer yourself (for example with genuinely purchased Roblox gift cards) and then mark the order fulfilled. Only run a store if you can honour every order, and know that reselling Robux may conflict with Roblox's own terms — that responsibility is yours.</p>
          </article>

          <article id="doc-codes" className="docs-section">
            <h2><KeyRound size={18} /> Redeem codes</h2>
            <p>Each order code is derived from the payment transaction hash with keccak256 and encoded in a typo-resistant base32 with a checksum, formatted as <code>BLOX-XXXX-XXXX-XXXX-XXXX</code>. Because the code comes from the transaction, every code maps to exactly one real, explorer-verifiable payment and cannot be invented.</p>
            <p>Codes and orders are stored in your browser on the device that made them. Marking a code fulfilled is a one-way, once-only action so an order cannot be delivered twice on that device.</p>
          </article>

          <article id="doc-safety" className="docs-section">
            <h2><Lock size={18} /> Non-custodial safety</h2>
            <ul className="docs-list">
              <li><Check size={15} /> The app never asks for or stores a private key.</li>
              <li><Check size={15} /> Every launch, payment, and fulfillment is signed from your own wallet.</li>
              <li><Check size={15} /> There is no auto-signer, keeper, or backend wallet that can move your funds.</li>
              <li><Check size={15} /> Every contract address is public — verify the whole flow on the <button className="docs-link" onClick={() => navigate("contracts")}>Contracts</button> page.</li>
            </ul>
          </article>

          <article id="doc-setup" className="docs-section">
            <h2><Network size={18} /> Network &amp; setup</h2>
            <p>Bloxpad runs on Robinhood Chain (chain ID 4663, native gas token ETH). For a production deployment set these environment variables:</p>
            <div className="docs-env">
              <div><code>VITE_ROBINHOOD_RPC_URL</code><span>A dedicated RPC endpoint (Alchemy, Chainstack, QuickNode…). The public endpoint is rate limited.</span></div>
              <div><code>VITE_REOWN_PROJECT_ID</code><span>Reown / WalletConnect project id from dashboard.reown.com.</span></div>
              <div><code>VITE_PAIR_TOKEN_ADDRESS</code><span>Pair asset for launches. Defaults to RBLX; zero address for ETH.</span></div>
              <div><code>VITE_STORE_TREASURY_ADDRESS</code><span>Wallet that receives ETH from store purchases.</span></div>
            </div>
            <p className="docs-note">On Vercel, <code>VITE_*</code> values are read at build time — set them, then redeploy for changes to take effect.</p>
          </article>

          <article id="doc-faq" className="docs-section">
            <h2><HelpCircle size={18} /> FAQ</h2>
            <div className="docs-faq">
              <div><strong>Does Bloxpad give real Roblox Robux automatically?</strong><p>No. Nothing on-chain can mint Roblox currency. Store delivery is manual and handled by the operator. Any site promising automatic crypto-to-Robux is a scam.</p></div>
              <div><strong>Why does it say "No adapter yet"?</strong><p>That is expected. The optional ETH-to-RBLX adapter is not needed when launches already pair with RBLX — fees arrive as RBLX in your wallet.</p></div>
              <div><strong>Do you hold my funds?</strong><p>No. Bloxpad is a front end. Your wallet signs everything and custody never leaves it.</p></div>
              <div><strong>Is RBLX here the Roblox stock?</strong><p>The default pair token is the Roblox · Robinhood Token (RBLX). It is a tokenized asset on Robinhood Chain, not Roblox in-game currency. Verify the address yourself.</p></div>
            </div>
          </article>

          <div className="docs-foot">
            <p>Bloxpad is an independent interface. Not affiliated with Roblox Corporation, Robinhood Markets, Pons, or Uniswap. Always verify contract addresses before you transact.</p>
            <div className="docs-foot-links">
              <button className="docs-link" onClick={() => navigate("launch")}>Launch a coin <ArrowRight size={14} /></button>
              <button className="docs-link" onClick={() => navigate("contracts")}>See contracts <ArrowRight size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="site-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("feed")} aria-label="Bloxpad home">
          <img className="brand-icon" src="/images/bloxpad-logo.png" alt="" />
          <span>BLOX<span className="brand-accent">PAD</span></span>
        </button>
        <div className="topbar-actions">
          <Button className="launch-cta-btn" onClick={() => navigate("launch")}>
            <Rocket size={15} /> Launch a coin
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
          </nav>
          <div className="drawer-foot">
            <a className="drawer-social" href="https://x.com/bloxpadapp" target="_blank" rel="noreferrer">Follow @bloxpadapp on X</a>
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
        {view === "store" && storePage}
        {view === "launch" && launchPage}
        {view === "claim" && claimPage}
        {view === "how" && howPage}
        {view === "docs" && docsPage}
        {view === "contracts" && contractsPage}
      </main>

      <footer className="footer container">
        <button className="brand" onClick={() => navigate("feed")}><img className="brand-icon" src="/images/bloxpad-logo.png" alt="" /><span>BLOX<span className="brand-accent">PAD</span></span></button>
        <p>Bloxpad is an independent interface for Pons V2 on Robinhood Chain. Not affiliated with Roblox Corporation, Robinhood Markets, Pons, or Uniswap. R$ denotes the {ROBUX_TICKER} target token, not fiat.</p>
        <div className="footer-links">
          <a href="https://x.com/bloxpadapp" target="_blank" rel="noreferrer">@bloxpadapp <ArrowUpRight size={13} /></a>
          <button className="footer-docs-link" onClick={() => navigate("docs")}>Docs <ArrowRight size={13} /></button>
        </div>
      </footer>
    </div>
  );
}
