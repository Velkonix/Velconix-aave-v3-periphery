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
const RPC = process.env.MONAD_RPC || process.env.RPC_URL;
const CHAIN_ID = process.env.MONAD_CHAIN_ID ? Number(process.env.MONAD_CHAIN_ID) : 143;
const PRICE_FEED = process.env.MONAD_PRICE_FEED || '0xBcD78f76005B7515837af6b50c7C52BCf73822fb';

for (const [k, v] of Object.entries({ DEPLOYER_KEY: KEY, MONAD_RPC: RPC })) {
  if (!v) { console.error(`${k} env var is required`); process.exit(1); }
}

const K613_POOL_ADDRESSES_PROVIDER = '0x1f6E754C6F7A49e2d69e5341d65EcB8f8506C69c';

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
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'monad' });
  const wallet = new ethers.Wallet(KEY, provider);
  console.log('Deployer:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance :', ethers.utils.formatEther(balance), 'MON');
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
    const res = await c.getReservesData(K613_POOL_ADDRESSES_PROVIDER);
    console.log(`getReservesData OK, reserves count = ${res[0].length}`);
    res[0].forEach((r, i) => console.log(`  [${i}] ${r.symbol}  underlying=${r.underlyingAsset}`));
  } catch (e) {
    console.error('getReservesData REVERTED:', e.reason || e.message);
  }

  console.log('\n=== Deliverables ===');
  console.log(`NEXT_PUBLIC_MONAD_UI_POOL_DATA_PROVIDER=${uiPool}`);
  console.log(`NEXT_PUBLIC_MONAD_UI_INCENTIVE_DATA_PROVIDER=${uiInc}`);
  console.log(`NEXT_PUBLIC_MONAD_WALLET_BALANCE_PROVIDER=${walletBal}`);
})().catch((e) => { console.error(e); process.exit(1); });
