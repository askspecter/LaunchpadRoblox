# ROBUX/LOOP

**ROBUX/LOOP** adalah antarmuka launchpad non-custodial untuk Pons V2 di Robinhood Chain. Launch tetap memakai **native ETH sebagai pair**. Setiap launch memakai `ClaimToRBLXAdapter` khusus dengan owner dan treasury sendiri. Adapter dapat menyapu fee Pons, mengklaim ETH dari escrow, lalu menukarnya menjadi token target dalam satu transaksi atomik.

> Status saat ini: frontend dan smart contract sudah diimplementasikan serta diuji secara lokal. **Adapter belum dideploy dan tidak ada transaksi mainnet yang dijalankan oleh repository ini.**

## Cara kerjanya

Pons V2 menentukan quote asset saat launch dibuat. Jika quote asset adalah zero address, bonding curve dan pool hasil graduation tetap berdenominasi ETH. Pons kemudian membayar creator dalam quote asset yang sama, sehingga launch ETH menghasilkan creator fee dalam ETH.[1]

ROBUX/LOOP tidak mengubah mekanisme tersebut. Saat membuat launch, frontend mengisi `creatorFeeRecipient` dengan alamat adapter khusus launch tersebut. Owner dapat memakai `sweepCurveClaimAndBuy` sebelum graduation, `sweepPoolClaimAndBuy` sesudah graduation, atau `claimAndBuy` ketika fee sudah berada di escrow. Adapter kemudian mengeksekusi swap WETH/RBLX melalui Uniswap V3 `SwapRouter02` dan mengirim seluruh output langsung ke treasury.

```text
Trader → Pons V2 curve/pool (pair ETH)
                     ↓ creator fee
      launch-specific ClaimToRBLXAdapter
                     ↓ sweep
              Pons Fee Escrow
                     ↓ claim()
      launch-specific ClaimToRBLXAdapter
                     ↓ exactInputSingle()
             Uniswap V3 pool
                     ↓ RBLX
             launch treasury
```

Kontrak memakai **minimum output**, **deadline**, **reentrancy guard**, dan **owner-gated execution**. Pembatasan owner penting karena fungsi permissionless yang menerima `amountOutMinimum` dari caller dapat dipanggil penyerang dengan nilai nol untuk memaksa swap buruk. Treasury, token target, router, escrow, Pons meme hook, WETH, dan fee tier dibuat immutable saat deployment. Satu adapter tidak boleh dipakai bersama oleh creator yang berbeda karena seluruh output selalu masuk ke satu treasury immutable.

## Kontrak dan jaringan

Robinhood Chain adalah jaringan EVM dengan chain ID `4663` dan ETH sebagai native gas token.[2] Alamat Pons berasal dari dokumentasi integrasi resmi, sedangkan alamat Uniswap berasal dari halaman deployment Robinhood Chain.[1] [3]

| Komponen | Alamat |
|---|---|
| Pons V2 Factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Pons V2 Fee Escrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
| Pons V2 Meme Hook | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Uniswap V3 SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |
| Uniswap V3 Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` |

### Peringatan nama token

Ada dua aset berbeda yang mudah tertukar. Token komunitas bernama **Robux (RBLX)** ditemukan di `0xac3D5a9c7824a091b48AD5AAB101B0586444cb07`.[5] Token saham resmi **Roblox · Robinhood Token (RBLX)** berada di `0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8`.[4]

Skrip deployment sengaja **tidak mempunyai target token hard-coded**. Anda harus mengisi `TARGET_TOKEN_ADDRESS` secara eksplisit. Verifikasi alamat, decimals, likuiditas, dan pool sebelum deployment. Pemeriksaan read-only pada 22 September 2026 menemukan pool WETH/token komunitas Robux pada Uniswap V3 fee tier `10000`; kondisi pool dapat berubah dan harus dicek ulang.

## Menjalankan frontend

Gunakan Node.js 22 dan pnpm.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Frontend membaca konfigurasi launch Pons langsung dari chain dengan multicall, memeriksa `canLaunch(address)`, mengambil launch fee terbaru, dan mem-pin economics melalui `previewLaunchEconomics` sebelum wallet menandatangani transaksi. Jika `VITE_CLAIM_ADAPTER_ADDRESS` masih zero address, tombol launch dan claim tetap terkunci agar creator fee tidak diarahkan ke konfigurasi yang belum selesai. Untuk produksi, isi `VITE_ROBINHOOD_RPC_URL` dengan endpoint provider yang memiliki rate limit sesuai trafik aplikasi; endpoint publik bawaan hanya fallback pengembangan.[2]

## Menguji proyek

```bash
pnpm contracts:compile
pnpm contracts:test
pnpm check
pnpm build
```

Test suite mencakup claim dan swap berhasil, sweep curve, sweep pool, penolakan caller non-owner, minimum output nol, deadline kedaluwarsa, kondisi tanpa fee, serta rollback atomik ketika proteksi slippage gagal. Pada versi ini seluruh delapan unit test lolos, pemeriksaan TypeScript lolos, dan build produksi berhasil.

## Deployment adapter dilakukan oleh pengguna

Repository menyediakan skrip deployment, tetapi tidak menyiarkan transaksi secara otomatis. Simpan private key hanya di environment lokal dan jangan pernah commit file `.env`.

```bash
cp .env.example .env
# Isi ROBINHOOD_RPC_URL, DEPLOYER_PRIVATE_KEY, TREASURY_ADDRESS,
# TARGET_TOKEN_ADDRESS, dan UNISWAP_POOL_FEE.
pnpm deploy:adapter
```

Deploy **satu adapter untuk setiap launch/treasury**. Setelah deployment, salin alamat adapter khusus itu ke `VITE_CLAIM_ADAPTER_ADDRESS`. Pastikan wallet deployer adalah owner yang akan menjalankan sweep dan claim. Frontend menolak launch jika wallet terhubung bukan owner adapter.

Fee yang baru tercatat dari trade belum tentu langsung terlihat di escrow. Dokumentasi Pons menjelaskan bahwa fee harus disweep dari curve atau hook lebih dahulu. UI menyediakan mode Curve dan Pool V4 untuk membaca fee pending serta memanggil sweep melalui adapter. Jika sweep membutuhkan internal swap atau buyback, Pons mewajibkan operator protokol; transaksi creator akan revert secara atomik. Setelah operator menyapu fee, gunakan mode Escrow.[1]

## Struktur utama

| Path | Fungsi |
|---|---|
| `client/src/pages/Home.tsx` | UI launch, wallet connection, dan claim-to-buy |
| `client/src/lib/web3.ts` | Konfigurasi chain, ABI, dan client viem |
| `contracts/ClaimToRBLXAdapter.sol` | Adapter claim ETH dan swap target token |
| `test/ClaimToRBLXAdapter.cjs` | Unit test keamanan dan atomicity |
| `scripts/deploy-adapter.cjs` | Skrip deployment manual |
| `client/public/images/` | Aset visual WebP yang sudah dioptimalkan |

## Batas keamanan

Kontrak ini **belum diaudit secara independen**. Pons V2 sendiri menyatakan audit protokol masih berlangsung pada dokumentasi yang diakses saat implementasi.[1] Launch baru juga dapat dibatasi whitelist; frontend memeriksa `canLaunch` sebelum mengirim transaksi.

Tidak ada private key, auto-signer, keeper, atau wallet custody di aplikasi. Semua transaksi membutuhkan persetujuan wallet pengguna. Harga minimum RBLX harus diperoleh dari quote yang tepercaya tepat sebelum claim; frontend sengaja tidak mengisi nilai tersebut secara otomatis tanpa layanan quote terverifikasi.

Proyek ini tidak berafiliasi dengan Roblox Corporation, Robinhood Markets, Pons, atau Uniswap. Nama dan simbol token tidak membuktikan identitas aset. Selalu verifikasi alamat kontrak.

## References

[1]: https://docs.ponsfamily.com/v2 "Pons V2 Documentation"
[2]: https://docs.robinhood.com/chain/connecting/ "Connecting to Robinhood Chain"
[3]: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments "Uniswap V3 Robinhood Chain Deployments"
[4]: https://docs.robinhood.com/chain/contracts/ "Robinhood Chain Token Contracts"
[5]: https://robinhoodchain.blockscout.com/token/0xac3D5a9c7824a091b48AD5AAB101B0586444cb07 "Robux RBLX Token on Robinhood Chain Explorer"
