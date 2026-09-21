import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  Box,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Fuel,
  LoaderCircle,
  LockKeyhole,
  Network,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatEther,
  isAddress,
  isAddressEqual,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { Button } from "@/components/ui/button";
import {
  adapterAbi,
  connectInjectedWallet,
  contracts,
  curveFeeAbi,
  escrowAbi,
  explorerAddress,
  explorerTx,
  factoryAbi,
  hookFeeAbi,
  publicClient,
  type LaunchConfig,
} from "@/lib/web3";

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

const shorten = (value: string, size = 5) =>
  `${value.slice(0, size + 2)}…${value.slice(-size)}`;

const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value);
  toast.success("Alamat disalin");
};

function StatusPill({ ready }: { ready: boolean }) {
  return (
    <span className={`status-pill ${ready ? "status-ready" : "status-warn"}`}>
      <span className="status-dot" />
      {ready ? "Adapter siap" : "Perlu deployment"}
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
          {isUnset ? "Belum dikonfigurasi" : shorten(address, 7)}
        </span>
      </div>
      {!isUnset && (
        <div className="flex items-center gap-1">
          <button className="icon-button" onClick={() => copyText(address)} aria-label={`Salin ${label}`}>
            <Copy size={15} />
          </button>
          <a className="icon-button" href={explorerAddress(address)} target="_blank" rel="noreferrer" aria-label={`Buka ${label} di explorer`}>
            <ExternalLink size={15} />
          </a>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [account, setAccount] = useState<Address | null>(null);
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
  const [loading, setLoading] = useState<"connect" | "launch" | "claim" | "fees" | null>(null);
  const [lastHash, setLastHash] = useState<Hash | null>(null);

  const adapterReady = !isAddressEqual(contracts.claimAdapter, zeroAddress);
  const isAdapterOwner = Boolean(
    account && adapterOwner && isAddressEqual(account, adapterOwner),
  );
  const activeConfig = useMemo(
    () => configs.find((config) => config.id === selectedConfig),
    [configs, selectedConfig],
  );

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
      if (open.length > 0) setSelectedConfig((current) => (open.some((item) => item.id === current) ? current : open[0].id));
    } catch {
      toast.error("Data Pons belum dapat dibaca. RPC publik mungkin sedang dibatasi.");
    }
  }, []);

  const refreshWalletState = useCallback(async (wallet?: Address | null) => {
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
  }, [account, adapterReady]);

  useEffect(() => {
    refreshProtocol();
    refreshWalletState(null);
  }, [refreshProtocol, refreshWalletState]);

  const connect = async () => {
    setLoading("connect");
    try {
      const { account: connected } = await connectInjectedWallet();
      setAccount(connected);
      await refreshWalletState(connected);
      toast.success("Wallet terhubung ke Robinhood Chain");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghubungkan wallet");
    } finally {
      setLoading(null);
    }
  };

  const launch = async () => {
    if (!account) return connect();
    if (!adapterReady) return toast.error("Deploy ClaimToRBLXAdapter lalu isi VITE_CLAIM_ADAPTER_ADDRESS.");
    if (!adapterOwner) return toast.error("Owner adapter belum dapat diverifikasi dari chain.");
    if (adapterOwner && !isAdapterOwner) return toast.error("Wallet ini bukan owner adapter. Gunakan adapter khusus milik launch ini.");
    if (!form.name.trim() || !form.symbol.trim() || !form.description.trim()) {
      return toast.error("Nama, ticker, dan deskripsi wajib diisi.");
    }
    if (!activeConfig) return toast.error("Tidak ada konfigurasi launch Pons yang aktif.");
    if (canLaunch === false) return toast.error("Alamat ini belum diizinkan membuat launch di Pons V2.");

    setLoading("launch");
    try {
      const { walletClient } = await connectInjectedWallet();
      const expectedEconomics = await publicClient.readContract({
        address: contracts.ponsFactory,
        abi: factoryAbi,
        functionName: "previewLaunchEconomics",
        args: [selectedConfig, zeroAddress],
      });
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const hash = await walletClient.writeContract({
        account,
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
            creatorTaxBps: Number(form.creatorTax),
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
      toast.success("Transaksi launch dikirim");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.slice(0, 160) : "Launch gagal");
    } finally {
      setLoading(null);
    }
  };

  const readPendingFees = async () => {
    setLoading("fees");
    try {
      if (claimMode === "curve") {
        if (!isAddress(curveAddress)) throw new Error("Alamat curve tidak valid.");
        const [baseFee, creatorTax] = await publicClient.multicall({
          allowFailure: false,
          contracts: [
            { address: curveAddress, abi: curveFeeAbi, functionName: "quoteFeeBalance" },
            { address: curveAddress, abi: curveFeeAbi, functionName: "creatorTaxBalance" },
          ],
        });
        setPendingFees(baseFee + creatorTax);
      } else if (claimMode === "pool") {
        if (!/^0x[0-9a-fA-F]{64}$/.test(poolId)) throw new Error("Pool ID harus bytes32 (0x + 64 karakter hex).");
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
      toast.error(error instanceof Error ? error.message : "Gagal membaca fee pending");
    } finally {
      setLoading(null);
    }
  };

  const claimAndBuy = async () => {
    if (!account) return connect();
    if (!adapterReady) return toast.error("Adapter belum dikonfigurasi.");
    if (!isAdapterOwner) return toast.error("Hanya owner adapter yang dapat menentukan slippage dan menjalankan swap.");
    if (!minRblxOut || Number(minRblxOut) <= 0) return toast.error("Isi minimum RBLX yang harus diterima untuk proteksi slippage.");
    if (claimMode === "escrow" && claimable === BigInt(0)) return toast.error("Belum ada ETH yang siap di-claim dari escrow.");
    if (claimMode === "curve" && !isAddress(curveAddress)) return toast.error("Alamat curve tidak valid.");
    if (claimMode === "pool" && !/^0x[0-9a-fA-F]{64}$/.test(poolId)) return toast.error("Pool ID tidak valid.");

    setLoading("claim");
    try {
      const { walletClient } = await connectInjectedWallet();
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
      const amountOutMinimum = parseUnits(minRblxOut, 18);
      const hash = claimMode === "curve"
        ? await walletClient.writeContract({
            account,
            address: contracts.claimAdapter,
            abi: adapterAbi,
            functionName: "sweepCurveClaimAndBuy",
            args: [curveAddress as Address, BigInt(0), amountOutMinimum, deadline],
          })
        : claimMode === "pool"
          ? await walletClient.writeContract({
              account,
              address: contracts.claimAdapter,
              abi: adapterAbi,
              functionName: "sweepPoolClaimAndBuy",
              args: [poolId as Hash, BigInt(0), BigInt(0), amountOutMinimum, deadline],
            })
          : await walletClient.writeContract({
              account,
              address: contracts.claimAdapter,
              abi: adapterAbi,
              functionName: "claimAndBuy",
              args: [amountOutMinimum, deadline],
            });
      setLastHash(hash);
      toast.success("Transaksi dikirim; menunggu konfirmasi…");
      await publicClient.waitForTransactionReceipt({ hash });
      await refreshWalletState(account);
      setPendingFees(null);
      toast.success("Fee berhasil diproses menjadi RBLX");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Claim gagal";
      toast.error(message.includes("InternalSwapRequiresOperator")
        ? "Sweep ini memerlukan operator Pons karena ada internal swap atau buyback. Tunggu operator menyapu fee, lalu gunakan mode Escrow."
        : message.slice(0, 160));
    } finally {
      setLoading(null);
    }
  };

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Robux Loop beranda">
          <img className="brand-icon" src="/images/robux-loop-icon.webp" alt="" />
          <span>ROBUX<span className="brand-accent">/LOOP</span></span>
        </a>
        <nav className="nav-links" aria-label="Navigasi utama">
          <a href="#launch">Launch</a>
          <a href="#loop">Fee loop</a>
          <a href="#contracts">Kontrak</a>
        </nav>
        <Button className="wallet-button" onClick={connect} disabled={loading === "connect"}>
          {loading === "connect" ? <LoaderCircle className="animate-spin" size={16} /> : <Wallet size={16} />}
          {account ? shorten(account) : "Connect wallet"}
        </Button>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="hero-copy">
            <div className="eyebrow"><span /> Built on Pons V2 · Robinhood Chain</div>
            <h1>Launch pakai ETH.<br /><em>Putar fee ke RBLX.</em></h1>
            <p className="hero-lede">
              Pair bonding curve tetap native ETH. Setiap launch memakai adapter khusus; creator fee disweep ke escrow Pons, lalu ditukar menjadi token Robux pilihanmu dan dikirim ke treasury.
            </p>
            <div className="hero-actions">
              <a className="primary-cta" href="#launch">Buat launch <ArrowDownRight size={18} /></a>
              <a className="text-link" href="#loop">Lihat alurnya <ArrowRight size={16} /></a>
            </div>
            <div className="hero-notes">
              <span><LockKeyhole size={14} /> Non-custodial</span>
              <span><ShieldCheck size={14} /> Slippage-protected</span>
              <span><Network size={14} /> Chain ID 4663</span>
            </div>
          </div>

          <div className="hero-visual" aria-label="Visual alur ETH ke RBLX">
            <div className="hero-glow" />
            <img className="hero-asset" src="/images/robux-loop-hero.webp" alt="Sculpture 3D yang menggambarkan alur ETH menuju token berbentuk kubus" />
            <div className="visual-card visual-eth"><span>01</span><strong>ETH</strong><small>pair asset</small></div>
            <div className="visual-card visual-pons"><span>02</span><strong>PONS V2</strong><small>bonding curve</small></div>
            <div className="visual-card visual-rblx"><span>03</span><strong>RBLX</strong><small>treasury loop</small></div>
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="cube-cluster">
              <span className="cube cube-a" /><span className="cube cube-b" /><span className="cube cube-c" />
              <span className="cube cube-d" /><span className="cube cube-e" />
            </div>
            <div className="visual-caption"><Zap size={15} /> CLAIM → SWAP → SEND</div>
          </div>
        </section>

        <section className="ticker-strip" aria-label="Ringkasan protokol">
          <div><span>QUOTE ASSET</span><strong>ETH</strong></div>
          <div><span>GRADUATION</span><strong>UNISWAP V4</strong></div>
          <div><span>CREATOR RECIPIENT</span><strong>CLAIM ADAPTER</strong></div>
          <div><span>TARGET</span><strong>RBLX</strong></div>
          <div><span>LIQUIDITY</span><strong>LOCKED</strong></div>
        </section>

        <section id="loop" className="section container">
          <div className="section-heading split-heading">
            <div>
              <div className="eyebrow"><span /> Cara kerja</div>
              <h2>Satu loop.<br />Tanpa mengubah pair.</h2>
            </div>
            <p>Pons tetap menghitung curve, graduation, dan fee dalam ETH. Yang berubah hanya alamat penerima creator fee: smart contract adapter, bukan wallet biasa.</p>
          </div>

          <div className="flow-grid">
            {[
              { n: "01", icon: Rocket, title: "Launch di Pons", text: "Token dibuat dengan pair native ETH dan creatorFeeRecipient diarahkan ke adapter khusus launch ini." },
              { n: "02", icon: Fuel, title: "Fee terkumpul", text: "Trading fee serta creator tax tersapu ke native ETH ledger milik adapter di escrow Pons." },
              { n: "03", icon: Sparkles, title: "Claim + buy", text: "Owner adapter memicu klaim. Adapter menukar ETH ke target RBLX dengan minimum output dan deadline." },
              { n: "04", icon: Box, title: "Masuk treasury", text: "RBLX hasil swap langsung dikirim ke treasury. Adapter tidak menyimpan saldo setelah transaksi selesai." },
            ].map((item, index) => (
              <article className="flow-card" key={item.n} style={{ animationDelay: `${index * 60}ms` }}>
                <div className="flow-meta"><span>{item.n}</span><item.icon size={19} /></div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                {index < 3 && <ArrowRight className="flow-arrow" size={18} />}
              </article>
            ))}
          </div>
        </section>

        <section id="launch" className="section launch-section container">
          <div className="launch-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow"><span /> Launch console</div>
                <h2>Siapkan tokenmu.</h2>
              </div>
              <StatusPill ready={adapterReady} />
            </div>

            <div className="form-grid">
              <label className="field"><span>Nama token</span><input value={form.name} onChange={(event) => setField("name", event.target.value)} placeholder="Block Party" /></label>
              <label className="field"><span>Ticker</span><input value={form.symbol} onChange={(event) => setField("symbol", event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10))} placeholder="BLOCK" /></label>
              <label className="field field-wide"><span>Deskripsi</span><textarea value={form.description} onChange={(event) => setField("description", event.target.value)} placeholder="Ceritakan kenapa launch ini layak diikuti…" rows={4} /></label>
              <label className="field"><span>Logo URL / IPFS</span><input value={form.logo} onChange={(event) => setField("logo", event.target.value)} placeholder="ipfs://…" /></label>
              <label className="field"><span>Website</span><input value={form.website} onChange={(event) => setField("website", event.target.value)} placeholder="https://…" /></label>
              <label className="field"><span>X / Twitter</span><input value={form.twitter} onChange={(event) => setField("twitter", event.target.value)} placeholder="https://x.com/…" /></label>
              <label className="field">
                <span>Creator tax</span>
                <select value={form.creatorTax} onChange={(event) => setField("creatorTax", event.target.value)}>
                  <option value="0">0.00%</option><option value="50">0.50%</option><option value="100">1.00%</option><option value="200">2.00%</option>
                </select>
              </label>
              <label className="field field-wide"><span>Konfigurasi Pons</span>
                <select value={selectedConfig.toString()} onChange={(event) => setSelectedConfig(BigInt(event.target.value))} disabled={configs.length === 0}>
                  {configs.length === 0 && <option value="0">Belum terbaca dari chain</option>}
                  {configs.map((config) => <option key={config.id.toString()} value={config.id.toString()}>Config #{config.id.toString()} · threshold {formatEther(config.graduationThreshold)} ETH</option>)}
                </select>
              </label>
              <label className="toggle-row field-wide">
                <button type="button" role="switch" aria-checked={form.buybackEnabled} className={`toggle ${form.buybackEnabled ? "toggle-on" : ""}`} onClick={() => setField("buybackEnabled", !form.buybackEnabled)}><span /></button>
                <span><strong>Aktifkan buyback bawaan Pons</strong><small>Opsional dan terpisah dari auto-buy RBLX eksternal.</small></span>
              </label>
            </div>

            <div className="launch-summary">
              <div><span>Pair</span><strong>Native ETH</strong></div>
              <div><span>Recipient</span><strong>{adapterReady ? shorten(contracts.claimAdapter) : "Adapter belum ada"}</strong></div>
              <div><span>Launch fee</span><strong>{formatEther(launchFee)} ETH</strong></div>
              <div><span>Eligibility</span><strong className={canLaunch === false ? "text-amber-300" : "text-lime-300"}>{canLaunch === null ? "Connect wallet" : canLaunch ? "Eligible" : "Whitelist required"}</strong></div>
            </div>

            <Button className="launch-button" onClick={launch} disabled={loading === "launch" || configs.length === 0 || (adapterReady && !adapterOwner) || Boolean(account && adapterOwner && !isAdapterOwner)}>
              {loading === "launch" ? <LoaderCircle className="animate-spin" size={18} /> : <Rocket size={18} />}
              {account ? "Launch dengan pair ETH" : "Connect untuk launch"}
              <ArrowRight size={18} />
            </Button>
            <p className="fineprint">Gunakan satu adapter per launch/treasury. Wallet kamu menandatangani langsung ke Pons V2; aplikasi tidak pernah meminta private key.</p>
          </div>

          <aside className="claim-panel">
            <div className="claim-top">
              <div className="claim-icon"><Zap size={23} /></div>
              <div><span>AUTO-BUY ENGINE</span><h3>Claim fee → RBLX</h3></div>
            </div>
            <div className="balance-card">
              <span>ETH siap di-claim</span>
              <strong>{Number(formatEther(claimable)).toLocaleString("id-ID", { maximumFractionDigits: 6 })}</strong>
              <small>di Pons Fee Escrow</small>
            </div>
            <div className="claim-modes" role="tablist" aria-label="Sumber fee">
              {(["escrow", "curve", "pool"] as ClaimMode[]).map((mode) => (
                <button key={mode} type="button" className={claimMode === mode ? "active" : ""} onClick={() => { setClaimMode(mode); setPendingFees(null); }}>
                  {mode === "escrow" ? "Escrow" : mode === "curve" ? "Curve" : "Pool V4"}
                </button>
              ))}
            </div>
            {claimMode === "curve" && (
              <label className="field dark-field"><span>Alamat bonding curve</span><input value={curveAddress} onChange={(event) => setCurveAddress(event.target.value)} placeholder="0x…" /></label>
            )}
            {claimMode === "pool" && (
              <label className="field dark-field"><span>Pool ID Pons / Uniswap V4</span><input value={poolId} onChange={(event) => setPoolId(event.target.value)} placeholder="0x + 64 karakter hex" /></label>
            )}
            {claimMode !== "escrow" && (
              <button className="pending-button" type="button" onClick={readPendingFees} disabled={loading === "fees"}>
                {loading === "fees" ? <LoaderCircle className="animate-spin" size={14} /> : <Network size={14} />}
                {pendingFees === null ? "Baca fee belum disweep" : `${Number(formatEther(pendingFees)).toLocaleString("id-ID", { maximumFractionDigits: 6 })} ETH pending`}
              </button>
            )}
            <label className="field dark-field"><span>Minimum RBLX diterima</span><input inputMode="decimal" value={minRblxOut} onChange={(event) => setMinRblxOut(event.target.value)} placeholder="Wajib untuk proteksi slippage" /></label>
            <Button className="claim-button" onClick={claimAndBuy} disabled={loading === "claim" || !adapterReady}>
              {loading === "claim" ? <LoaderCircle className="animate-spin" size={18} /> : <Zap size={18} />}
              {claimMode === "escrow" ? "Claim & buy RBLX" : "Sweep, claim & buy"}
            </Button>
            <div className="claim-checks">
              <span><Check size={14} /> Owner-gated execution</span>
              <span><Check size={14} /> Satu transaksi atomik</span>
              <span><Check size={14} /> Deadline 20 menit</span>
              <span><Check size={14} /> Output minimum onchain</span>
            </div>
            {claimMode !== "escrow" && <p className="operator-note">Jika sweep membutuhkan internal swap atau buyback Pons, transaksi creator akan revert. Tunggu operator Pons, lalu pakai mode Escrow.</p>}
            {lastHash && <a className="tx-link" href={explorerTx(lastHash)} target="_blank" rel="noreferrer">Lihat transaksi terakhir <ExternalLink size={14} /></a>}
          </aside>
        </section>

        <section id="contracts" className="section contracts-section container">
          <div className="contracts-copy">
            <div className="eyebrow"><span /> Verifikasi sendiri</div>
            <h2>Alamat, bukan janji.</h2>
            <p>Semua jalur nilai dapat diverifikasi lewat explorer. Target token dibuat configurable agar tidak tertukar dengan token saham Roblox resmi.</p>
            <div className="warning-box"><CircleAlert size={19} /><div><strong>Dua token berbeda memakai simbol RBLX.</strong><p>Default target saat ini adalah komunitas <b>Robux</b> di <code>0xac3D…cb07</code>. Token saham <b>Roblox · Robinhood Token</b> resmi berada di <code>0xF0C4…1bE8</code>. Konfirmasi target sebelum deploy adapter.</p></div></div>
          </div>
          <div className="contract-list">
            <AddressRow label="Pons V2 Factory" address={contracts.ponsFactory} />
            <AddressRow label="Pons Fee Escrow" address={contracts.ponsFeeEscrow} />
            <AddressRow label="Pons Meme Hook" address={contracts.ponsMemeHook} />
            <AddressRow label="Claim Adapter" address={contracts.claimAdapter} />
            <AddressRow label="Target Robux (default)" address={contracts.targetToken} />
            <AddressRow label="Official Roblox token" address={contracts.officialRobloxToken} />
            <AddressRow label="Uniswap SwapRouter02" address={contracts.uniswapRouter} />
          </div>
        </section>

        <section className="section safety-section container">
          <div className="safety-kicker"><BadgeCheck size={19} /> Built for transparent execution</div>
          <h2>Yang otomatis adalah rutenya.<br /><span>Bukan keputusannya.</span></h2>
          <p>Setiap launch, claim, dan swap tetap meminta tanda tangan wallet. Tidak ada bot dengan private key, tidak ada custody, dan tidak ada harga minimum tersembunyi.</p>
        </section>
      </main>

      <footer className="footer container">
        <div className="brand"><img className="brand-icon" src="/images/robux-loop-icon.webp" alt="" /><span>ROBUX<span className="brand-accent">/LOOP</span></span></div>
        <p>Independent interface for Pons V2 on Robinhood Chain. Not affiliated with Roblox Corporation, Robinhood Markets, Pons, or Uniswap.</p>
        <a href="https://docs.ponsfamily.com/v2" target="_blank" rel="noreferrer">Pons docs <ExternalLink size={13} /></a>
      </footer>
    </div>
  );
}
