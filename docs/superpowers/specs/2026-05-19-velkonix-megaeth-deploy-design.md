# Velkonix MegaETH periphery deploy — design

Date: 2026-05-19

## Goal

Replicate the k613/Monad approach for the **Velkonix MegaETH** network: deploy the
Aave v3 periphery data-provider contracts and verify them against the live pool.

## Context

The k613 work consisted of two parts:

1. A fork-neutral guard in `contracts/misc/UiPoolDataProviderV3.sol` that zeroes
   stable-debt fields when `stableDebtTokenAddress == address(0)`. **Already merged
   in `master`** (commit `b4dbeb1`), applies to every fork — no change needed.
2. `scripts/deploy-k613-monad.js` — deploys `UiPoolDataProviderV3`,
   `UiIncentiveDataProviderV3`, `WalletBalanceProvider`, then calls
   `getReservesData(poolAddressesProvider)` as a smoke test.

`package.json` already carries `cross-env` and `@tenderly/api-client` from the same
merge. Therefore the only new artifact for Velkonix is **one deploy script**.

## Addresses (from github.com/Velkonix/velconics-markets-config)

| Item | Value | Source file |
|---|---|---|
| Chain ID | `4326` | `src/networks/MegaEthMainnet.sol` |
| PoolAddressesProvider | `0x4E293100F46889B21a12C5884551FF340AD8d7b9` | `src/networks/MegaEthMainnet.sol` |
| Price feed (WETH/USD) | `0xcA4e254D95637DE95E2a2F79244b03380d697feD` | `src/payloads/VelkonixMegaEth_InitialListing.sol` (WETH row) |

## New file: `scripts/deploy-velkonix-megaeth.js`

Structural copy of `deploy-k613-monad.js`, differing only in addresses/env names.

Environment:

- `DEPLOYER_KEY` || `PRIVATE_KEY` — required (deployer key)
- `MEGAETH_RPC_URL` || `RPC_URL` — required (RPC endpoint)
- `MEGAETH_CHAIN_ID` — optional, default `4326`
- `MEGAETH_PRICE_FEED` — optional, default `0xcA4e254D95637DE95E2a2F79244b03380d697feD`

Hardcoded constant: `VELKONIX_POOL_ADDRESSES_PROVIDER = 0x4E293100F46889B21a12C5884551FF340AD8d7b9`.

Behavior (identical to k613):

1. Inline-parse `.env`, connect via `StaticJsonRpcProvider(RPC, { chainId, name: 'megaeth' })`.
2. Print deployer address + balance; abort on zero balance.
3. Deploy from `artifacts/contracts/misc/`:
   `UiPoolDataProviderV3([feed, feed])`, `UiIncentiveDataProviderV3()`,
   `WalletBalanceProvider()`.
4. Call `getReservesData(VELKONIX_POOL_ADDRESSES_PROVIDER)`, print reserves.
5. Print deliverables as `NEXT_PUBLIC_MEGAETH_*` env lines.

Precondition: contracts compiled (`yarn compile`) so artifacts exist.

## Out of scope

- No Solidity changes (guard already merged, fork-neutral).
- No `package.json` changes.
- The k613 script is left untouched.
