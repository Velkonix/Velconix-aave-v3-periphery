#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');


try {
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
} catch { }

const KEY = process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
const RPC = process.env.MEGAETH_RPC_URL || process.env.RPC_URL;
const CHAIN_ID = process.env.MEGAETH_CHAIN_ID ? Number(process.env.MEGAETH_CHAIN_ID) : 4326;
const PRICE_FEED = process.env.MEGAETH_PRICE_FEED || '0xcA4e254D95637DE95E2a2F79244b03380d697feD';

for (const [k, v] of Object.entries({ DEPLOYER_KEY: KEY, MEGAETH_RPC_URL: RPC })) {
  if (!v) { console.error(`${k} env var is required`); process.exit(1); }
}

const VELKONIX_POOL_ADDRESSES_PROVIDER = '0x4E293100F46889B21a12C5884551FF340AD8d7b9';

function loadArtifact(rel) {
  const p = path.join(__dirname, '..', 'artifacts', 'contracts', 'misc', rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function deploy(wallet, artifact, args, label) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log(`\n[${label}] deploying with args:`, args);
  const c = await factory.deploy(...args);
  console.log(`[${label}] tx: ${c.deployTransaction.hash}`);
  await c.deployed();
  console.log(`[${label}] deployed at: ${c.address}`);
  return c.address;
}

(async () => {
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'megaeth' });
  const wallet = new ethers.Wallet(KEY, provider);
  console.log('Deployer:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance :', ethers.utils.formatEther(balance), 'ETH');
  if (balance.isZero()) { console.error('Zero balance. Aborting.'); process.exit(1); }

  const uiPoolArt = loadArtifact('UiPoolDataProviderV3.sol/UiPoolDataProviderV3.json');
  const uiIncArt = loadArtifact('UiIncentiveDataProviderV3.sol/UiIncentiveDataProviderV3.json');
  const walletBalArt = loadArtifact('WalletBalanceProvider.sol/WalletBalanceProvider.json');

  const uiPool = await deploy(wallet, uiPoolArt, [PRICE_FEED, PRICE_FEED], 'UiPoolDataProviderV3');
  const uiInc = await deploy(wallet, uiIncArt, [], 'UiIncentiveDataProviderV3');
  const walletBal = await deploy(wallet, walletBalArt, [], 'WalletBalanceProvider');

  console.log('\n--- Verification: getReservesData on new UiPoolDataProviderV3 ---');
  const c = new ethers.Contract(uiPool, uiPoolArt.abi, provider);
  try {
    const res = await c.getReservesData(VELKONIX_POOL_ADDRESSES_PROVIDER);
    console.log(`getReservesData OK, reserves count = ${res[0].length}`);
    res[0].forEach((r, i) => console.log(`  [${i}] ${r.symbol}  underlying=${r.underlyingAsset}`));
  } catch (e) {
    console.error('getReservesData REVERTED:', e.reason || e.message);
  }

  console.log('\n=== Deliverables ===');
  console.log(`NEXT_PUBLIC_MEGAETH_UI_POOL_DATA_PROVIDER=${uiPool}`);
  console.log(`NEXT_PUBLIC_MEGAETH_UI_INCENTIVE_DATA_PROVIDER=${uiInc}`);
  console.log(`NEXT_PUBLIC_MEGAETH_WALLET_BALANCE_PROVIDER=${walletBal}`);
})().catch((e) => { console.error(e); process.exit(1); });
