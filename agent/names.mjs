// Name-based recipients, in the spirit of Fluid Names: a human tells the
// agent "pay data-vendor", and the name resolves to concrete addresses.
// The policy allowlist stores *resolved addresses*, never names — so a name
// can never become a loophole: whatever a name resolves to is what the
// policy engine checks.
//
// This registry is a local stand-in for an on-chain names registry; the
// NEAR entry is verified live against testnet RPC by the demo.
import { viewAccount } from "./near.mjs";

export const NAMES = {
  // The demo vendor is the project's own testnet account: it exists on
  // NEAR testnet, which the demo verifies with a live RPC read.
  "data-vendor": {
    nearTestnet: "spendguard-ethuram.testnet",
    // Recipient used for mainnet 1Click dry quotes (nothing is sent).
    // 1Click simulates the payout, so the payee must be a real mainnet
    // account; root.near stands in for the vendor in dry quotes only.
    intentsRecipient: "root.near",
    chain: "near",
  },
  // Ethuram's public Fluid name (from the Fluid names registry).
  ethuram: {
    evm: "0x0EBf5563F905E3B9D58718E28E08143511DC763b",
    chain: "base",
  },
};

export function resolveName(name) {
  const entry = NAMES[name];
  if (!entry) throw new Error(`unknown name: ${name}`);
  return { name, ...entry };
}

/** Live check: does the name's NEAR testnet account actually exist? */
export async function verifyNearName(name, fetchFn = fetch) {
  const entry = resolveName(name);
  if (!entry.nearTestnet) return { name, checked: false, exists: null };
  const account = await viewAccount(entry.nearTestnet, fetchFn);
  return { name, checked: true, exists: account !== null, account: entry.nearTestnet };
}
