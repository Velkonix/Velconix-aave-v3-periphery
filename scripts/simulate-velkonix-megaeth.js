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

const CHAIN_ID = 4326;
const PRICE_FEED = '0xcA4e254D95637DE95E2a2F79244b03380d697feD';
const VELKONIX_POOL_ADDRESSES_PROVIDER = '0x4E293100F46889B21a12C5884551FF340AD8d7b9';
const GAS_LIMIT = 85_000_000;

for (const [k, v] of Object.entries({ DEPLOYER_KEY: KEY, MEGAETH_RPC_URL: RPC })) {
  if (!v) { console.error(`${k} env var is required`); process.exit(1); }
}

function loadArtifact(rel) {
  const p = path.join(__dirname, '..', 'artifacts', 'contracts', 'misc', rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildInitcode(artifact, args) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const tx = factory.getDeployTransaction(...args);
  return tx.data;
}

function decodeRevert(returnData) {
  if (!returnData || returnData === '0x') return '(no return data — likely out-of-gas / invalid opcode)';
  // Error(string) selector 0x08c379a0
  if (returnData.startsWith('0x08c379a0')) {
    try {
      const reason = ethers.utils.defaultAbiCoder.decode(['string'], '0x' + returnData.slice(10))[0];
      return `Error(string): "${reason}"`;
    } catch { /* fallthrough */ }
  }
  // Panic(uint256) selector 0x4e487b71
  if (returnData.startsWith('0x4e487b71')) {
    try {
      const code = ethers.utils.defaultAbiCoder.decode(['uint256'], '0x' + returnData.slice(10))[0];
      return `Panic(uint256): 0x${code.toHexString().slice(2).padStart(2, '0')}`;
    } catch { /* fallthrough */ }
  }
  return `raw: ${returnData}`;
}

async function simulate(provider, from, artifact, args, label) {
  const initcode = buildInitcode(artifact, args);
  const initcodeBytes = (initcode.length - 2) / 2;
  const deployedBytes = ((artifact.deployedBytecode || '').length - 2) / 2;
  console.log(`\n=== ${label} ===`);
  console.log(`  args             : ${JSON.stringify(args)}`);
  console.log(`  initcode bytes   : ${initcodeBytes}`);
  console.log(`  deployed bytes   : ${deployedBytes}  (EIP-170 limit 24576)`);

  // 1) eth_call without gas cap — pure simulation. Returns runtime bytecode on success.
  try {
    const ret = await provider.call({ from, data: initcode, gasLimit: GAS_LIMIT });
    const retBytes = (ret.length - 2) / 2;
    if (retBytes === 0) {
      console.log(`  eth_call         : returned 0x (creation failed silently — out-of-gas or invalid opcode)`);
    } else {
      console.log(`  eth_call         : OK, returned ${retBytes} bytes of runtime code` + (retBytes === deployedBytes ? '  ✓ matches artifact' : '  ⚠ size mismatch'));
    }
  } catch (e) {
    const body = e.error && e.error.body;
    const errData = (e.error && (e.error.data || (e.error.error && e.error.error.data))) || e.data;
    console.log(`  eth_call         : REVERT — ${decodeRevert(errData)}`);
    if (body) console.log(`    rpc body       : ${body}`);
    if (e.reason) console.log(`    reason         : ${e.reason}`);
  }

  // 2) eth_estimateGas separately to see chain's verdict.
  try {
    const est = await provider.estimateGas({ from, data: initcode });
    console.log(`  estimateGas      : ${est.toString()}  (~${(Number(est) / 1e6).toFixed(2)}M)`);
  } catch (e) {
    const body = e.error && e.error.body;
    const msg = (e.error && e.error.message) || e.message;
    console.log(`  estimateGas      : FAILED — ${msg}`);
    if (body) console.log(`    rpc body       : ${body}`);
  }
}

(async () => {
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'megaeth' });
  const wallet = new ethers.Wallet(KEY, provider);
  const from = wallet.address;
  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  const balance = await provider.getBalance(from);

  console.log('--- env ---');
  console.log(`  rpc             : ${RPC}`);
  console.log(`  chainId         : ${CHAIN_ID}`);
  console.log(`  from            : ${from}`);
  console.log(`  balance         : ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`  blockNumber     : ${blockNumber}`);
  console.log(`  block gasLimit  : ${block.gasLimit.toString()}  (~${(Number(block.gasLimit) / 1e6).toFixed(2)}M)`);
  console.log(`  baseFee         : ${block.baseFeePerGas ? block.baseFeePerGas.toString() : 'n/a (pre-EIP-1559)'}`);

  const uiPoolArt = loadArtifact('UiPoolDataProviderV3.sol/UiPoolDataProviderV3.json');
  const uiIncArt = loadArtifact('UiIncentiveDataProviderV3.sol/UiIncentiveDataProviderV3.json');
  const walletBalArt = loadArtifact('WalletBalanceProvider.sol/WalletBalanceProvider.json');

  await simulate(provider, from, uiPoolArt, [PRICE_FEED, PRICE_FEED], 'UiPoolDataProviderV3');
  await simulate(provider, from, uiIncArt, [], 'UiIncentiveDataProviderV3');
  await simulate(provider, from, walletBalArt, [], 'WalletBalanceProvider');

  // Sanity: try calling getReservesData on the LIVE pool via a hypothetical UiPool address.
  // We can't call methods on a not-yet-deployed contract, but we CAN inspect the live PoolAddressesProvider.
  console.log('\n=== Live PoolAddressesProvider sanity ===');
  const provIface = new ethers.utils.Interface([
    'function getPool() view returns (address)',
    'function getPriceOracle() view returns (address)',
    'function getPoolDataProvider() view returns (address)',
  ]);
  const probe = new ethers.Contract(VELKONIX_POOL_ADDRESSES_PROVIDER, provIface, provider);
  try {
    const [pool, oracle, dataProv] = await Promise.all([
      probe.getPool(), probe.getPriceOracle(), probe.getPoolDataProvider(),
    ]);
    console.log(`  Pool             : ${pool}`);
    console.log(`  PriceOracle      : ${oracle}`);
    console.log(`  PoolDataProvider : ${dataProv}`);
  } catch (e) {
    console.log(`  PROBE FAILED     : ${e.reason || e.message}`);
  }

  console.log('\nDone (no transactions sent).');
})().catch((e) => { console.error(e); process.exit(1); });
