import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain as defineAppKitChain } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import {
  createPublicClient,
  defineChain as defineViemChain,
  http,
  parseAbi,
  zeroAddress,
  type Address,
} from "viem";

export const robinhoodRpcUrl =
  import.meta.env.VITE_ROBINHOOD_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

// Reown (WalletConnect) project id. Create one for free at https://dashboard.reown.com
// and expose it as VITE_REOWN_PROJECT_ID. The fallback keeps the app booting with
// injected/browser wallets; the WalletConnect QR flow needs a real project id.
export const REOWN_PROJECT_ID =
  import.meta.env.VITE_REOWN_PROJECT_ID || "b56e18d47c72ab683b10814fe9495694";

const explorerUrl = "https://robinhoodchain.blockscout.com";

// viem chain — used by the read-only public client.
export const robinhoodChain = defineViemChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [robinhoodRpcUrl] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: explorerUrl },
  },
});

// AppKit network — used by the Reown adapter and connect modal.
export const robinhoodNetwork: AppKitNetwork = defineAppKitChain({
  id: 4663,
  caipNetworkId: "eip155:4663",
  chainNamespace: "eip155",
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [robinhoodRpcUrl] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: explorerUrl },
  },
});

export const wagmiAdapter = new WagmiAdapter({
  networks: [robinhoodNetwork],
  projectId: REOWN_PROJECT_ID,
  ssr: false,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

const envAddress = (key: string, fallback: Address): Address => {
  const value = import.meta.env[key];
  return (typeof value === "string" && value.startsWith("0x")
    ? value
    : fallback) as Address;
};

export const contracts = {
  ponsFactory: envAddress(
    "VITE_PONS_FACTORY_ADDRESS",
    "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  ),
  ponsFeeEscrow: envAddress(
    "VITE_PONS_FEE_ESCROW_ADDRESS",
    "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
  ),
  ponsMemeHook: envAddress(
    "VITE_PONS_MEME_HOOK_ADDRESS",
    "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
  ),
  claimAdapter: envAddress("VITE_CLAIM_ADAPTER_ADDRESS", zeroAddress),
  // Address that receives ETH from RBLX voucher-store purchases. Set this to
  // the treasury/operator wallet that fulfils redeem codes into RBLX.
  storeTreasury: envAddress("VITE_STORE_TREASURY_ADDRESS", zeroAddress),
  targetToken: envAddress(
    "VITE_TARGET_TOKEN_ADDRESS",
    "0xac3D5a9c7824a091b48AD5AAB101B0586444cb07",
  ),
  officialRobloxToken: envAddress(
    "VITE_OFFICIAL_RBLX_ADDRESS",
    "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8",
  ),
  uniswapRouter: envAddress(
    "VITE_UNISWAP_ROUTER_ADDRESS",
    "0xcaf681a66d020601342297493863e78c959e5cb2",
  ),
} as const;

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodRpcUrl),
});

export const factoryAbi = parseAbi([
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function canLaunch(address account) view returns (bool)",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)",
]);

export const escrowAbi = parseAbi([
  "function balanceOf(address recipient) view returns (uint256)",
]);

export const curveFeeAbi = parseAbi([
  "function quoteFeeBalance() view returns (uint256)",
  "function creatorTaxBalance() view returns (uint256)",
]);

export const hookFeeAbi = parseAbi([
  "function pendingFees(bytes32 poolId, address currency) view returns (uint256)",
  "function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)",
]);

export const adapterAbi = parseAbi([
  "function claimAndBuy(uint256 amountOutMinimum, uint256 deadline) returns (uint256 amountIn, uint256 amountOut)",
  "function sweepCurveClaimAndBuy(address curve, uint256 minBuybackTokensOut, uint256 amountOutMinimum, uint256 deadline) returns (uint256 amountIn, uint256 amountOut)",
  "function sweepPoolClaimAndBuy(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut, uint256 amountOutMinimum, uint256 deadline) returns (uint256 amountIn, uint256 amountOut)",
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function targetToken() view returns (address)",
]);

export type LaunchConfig = {
  id: bigint;
  supply: bigint;
  curveFeeBps: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  enabled: boolean;
};

export const explorerAddress = (address: Address) =>
  `${explorerUrl}/address/${address}`;

export const explorerTx = (hash: `0x${string}`) => `${explorerUrl}/tx/${hash}`;
