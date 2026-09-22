# ROBUX/LOOP

**ROBUX/LOOP** is a non-custodial launchpad interface for Pons V2 on Robinhood Chain. Every launch keeps **native ETH as the pair**. Each launch uses a dedicated `ClaimToRBLXAdapter` with its own owner and treasury. The adapter can sweep Pons fees, claim the ETH from escrow, and swap it into the target token — **Robux (RBLX)** — in a single atomic transaction.

> Current status: the frontend and smart contract are implemented and tested locally. **The adapter is not deployed and no mainnet transaction is broadcast by this repository.**

## What "paired with ETH, currency in Robux" means

Pons V2 sets the quote asset when a launch is created. If the quote asset is the zero address, the bonding curve and the post-graduation pool stay denominated in ETH. Pons then pays the creator in that same quote asset, so an ETH launch produces creator fees in ETH.[1]

ROBUX/LOOP does not change that mechanism. The trading pair underneath every launch remains native ETH. What the interface adds is a **loop into Robux**: the creator-fee recipient is a launch-specific adapter that claims the accrued ETH and swaps it into the Robux (RBLX) token, so the value the launch accumulates ends up denominated in the Roblox in-game currency. The `R$` symbol in the UI always refers to the RBLX target token, never fiat.

```text
Trader → Pons V2 curve/pool (ETH pair)
                     ↓ creator fee
      launch-specific ClaimToRBLXAdapter
                     ↓ sweep
              Pons Fee Escrow
                     ↓ claim()
      launch-specific ClaimToRBLXAdapter
                     ↓ exactInputSingle()
             Uniswap V3 pool
                     ↓ RBLX (Robux)
             launch treasury
```

The contract uses a **minimum output**, a **deadline**, a **reentrancy guard**, and **owner-gated execution**. The owner restriction matters because a permissionless function that accepts `amountOutMinimum` from the caller could be called by an attacker with a zero value to force a bad swap. Treasury, target token, router, escrow, Pons meme hook, WETH, and fee tier are immutable at deployment. One adapter must not be shared by different creators because all output always goes to a single immutable treasury.

## Features

- **Reown (WalletConnect) wallet connection** — the "Connect wallet" button opens the Reown AppKit modal, which supports injected/browser wallets and the WalletConnect QR flow. Set `VITE_REOWN_PROJECT_ID` to enable WalletConnect fully.
- **Launch console** — reads live Pons launch configs from chain, checks `canLaunch`, pins economics with `previewLaunchEconomics`, and routes the creator fee to your dedicated adapter.
- **Claim → Robux engine** — Escrow, Curve, and Pool V4 fee sources, each with on-chain minimum output and a 20-minute deadline.
- **Live launch feed** — every token launched through the interface is added to a feed (name, ticker, description, links, transaction), stored locally in the browser.
- **English UI, dark and clean.**

## Contracts and network

Robinhood Chain is an EVM network with chain ID `4663` and ETH as the native gas token.[2] The Pons addresses come from the official integration docs; the Uniswap addresses come from the Robinhood Chain deployment page.[1] [3]

| Component | Address |
|---|---|
| Pons V2 Factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Pons V2 Fee Escrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
| Pons V2 Meme Hook | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Uniswap V3 SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |
| Uniswap V3 Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` |

### Token name warning

Two different assets are easy to confuse. The community token named **Robux (RBLX)** is at `0xac3D5a9c7824a091b48AD5AAB101B0586444cb07`.[5] The official **Roblox · Robinhood Token (RBLX)** stock token is at `0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8`.[4]

The deployment script intentionally **has no hard-coded target token**. You must set `TARGET_TOKEN_ADDRESS` explicitly. Verify the address, decimals, liquidity, and pool before deployment. A read-only check on 22 September 2026 found a WETH/community-Robux pool on Uniswap V3 fee tier `10000`; pool conditions can change and must be re-checked.

## Running the frontend

Use Node.js 22 and pnpm.

```bash
pnpm install
cp .env.example .env.local
# Set VITE_REOWN_PROJECT_ID (https://dashboard.reown.com) to enable WalletConnect.
pnpm dev
```

The frontend reads Pons launch config directly from chain with multicall, checks `canLaunch(address)`, fetches the latest launch fee, and pins economics via `previewLaunchEconomics` before the wallet signs. If `VITE_CLAIM_ADAPTER_ADDRESS` is still the zero address, the launch and claim buttons stay locked so creator fees are not routed to an unfinished configuration. For production, set `VITE_ROBINHOOD_RPC_URL` to a provider endpoint whose rate limit matches your traffic; the default public endpoint is a development fallback only.[2]

## Deploying to Vercel

The app is a static single-page app. `vercel.json` configures the build:

```json
{
  "buildCommand": "vite build",
  "outputDirectory": "dist/public",
  "installCommand": "pnpm install --no-frozen-lockfile",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Set the `VITE_*` environment variables (at minimum `VITE_REOWN_PROJECT_ID`, and `VITE_CLAIM_ADAPTER_ADDRESS` once you have deployed an adapter) in the Vercel project settings. No Node server is required — the SPA rewrite handles client-side routing.

## Testing the project

```bash
pnpm contracts:compile
pnpm contracts:test
pnpm check
pnpm build
```

The test suite covers a successful claim and swap, curve sweep, pool sweep, non-owner caller rejection, zero minimum output, expired deadline, the no-fee condition, and an atomic rollback when slippage protection fails.

## Adapter deployment is done by the user

The repository provides a deployment script but does not broadcast transactions automatically. Keep private keys only in your local environment and never commit a `.env` file.

```bash
cp .env.example .env
# Fill in ROBINHOOD_RPC_URL, DEPLOYER_PRIVATE_KEY, TREASURY_ADDRESS,
# TARGET_TOKEN_ADDRESS, and UNISWAP_POOL_FEE.
pnpm deploy:adapter
```

Deploy **one adapter per launch/treasury**. After deployment, copy that dedicated adapter address into `VITE_CLAIM_ADAPTER_ADDRESS`. Make sure the deployer wallet is the owner that will run the sweeps and claims. The frontend rejects a launch if the connected wallet is not the adapter owner.

Newly recorded trade fees are not always immediately visible in escrow. The Pons docs explain that fees must first be swept from the curve or hook. The UI provides Curve and Pool V4 modes to read pending fees and call the sweep through the adapter. If a sweep requires an internal swap or buyback, Pons requires a protocol operator; the creator transaction reverts atomically. Once the operator has swept the fees, use Escrow mode.[1]

## Main structure

| Path | Purpose |
|---|---|
| `client/src/pages/Home.tsx` | Launch UI, wallet connection, feed, and claim-to-buy |
| `client/src/lib/web3.ts` | Chain, Reown/wagmi config, ABIs, and viem client |
| `client/src/providers/Web3Provider.tsx` | Reown AppKit + wagmi + react-query providers |
| `client/src/lib/feed.ts` | Local launch feed storage |
| `contracts/ClaimToRBLXAdapter.sol` | Adapter that claims ETH and swaps to the target token |
| `test/ClaimToRBLXAdapter.cjs` | Security and atomicity unit tests |
| `scripts/deploy-adapter.cjs` | Manual deployment script |

## Security boundaries

This contract is **not independently audited**. Pons V2 itself states that a protocol audit is still in progress in the documentation accessed during implementation.[1] New launches may also be whitelist-gated; the frontend checks `canLaunch` before sending a transaction.

There is no private key, auto-signer, keeper, or wallet custody in the app. Every transaction requires the user's wallet approval. A minimum RBLX price must come from a trusted quote right before the claim; the frontend intentionally does not fill that value automatically without a verified quote service.

This project is not affiliated with Roblox Corporation, Robinhood Markets, Pons, or Uniswap. Token names and symbols do not prove an asset's identity. Always verify contract addresses.

## References

[1]: https://docs.ponsfamily.com/v2 "Pons V2 Documentation"
[2]: https://docs.robinhood.com/chain/connecting/ "Connecting to Robinhood Chain"
[3]: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments "Uniswap V3 Robinhood Chain Deployments"
[4]: https://docs.robinhood.com/chain/contracts/ "Robinhood Chain Token Contracts"
[5]: https://robinhoodchain.blockscout.com/token/0xac3D5a9c7824a091b48AD5AAB101B0586444cb07 "Robux RBLX Token on Robinhood Chain Explorer"
