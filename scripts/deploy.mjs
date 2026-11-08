// Deploy the SpendGuard contract to NEAR testnet and initialise it.
// Usage: node scripts/deploy.mjs
// Credentials: .keys/<account>.json (NEAR CLI format, gitignored, 0600).
// Testnet only — the account id must end in .testnet.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sendTx } from "./near-tx.mjs";
import { callView } from "../agent/near.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT = process.env.SPENDGUARD_ACCOUNT ?? "spendguard-ethuram.testnet";
if (!ACCOUNT.endsWith(".testnet")) throw new Error("refusing to deploy outside testnet");
const creds = JSON.parse(readFileSync(join(root, ".keys", `${ACCOUNT}.json`), "utf8"));
const auth = { signerId: ACCOUNT, privateKey: creds.private_key, publicKey: creds.public_key };

export const POLICY_ARGS = {
  owner: ACCOUNT,
  policy: {
    per_tx_cap_usd_micros: 25_000_000,
    daily_cap_usd_micros: 60_000_000,
    max_slippage_bps: 200,
    allowed_recipients: ["root.near"],
    allowed_assets: ["nep141:wrap.near"],
    allowed_chains: ["near"],
  },
};

function assertSuccess(label, outcome) {
  const s = JSON.stringify(outcome.status ?? {});
  if (s.includes("Failure")) throw new Error(`${label} failed on-chain: ${s.slice(0, 400)}`);
  console.log(`${label}: status ${s.slice(0, 120)}`);
}

const wasm = readFileSync(join(root, "contract/target/wasm32-unknown-unknown/release/spendguard.wasm"));
console.log(`deploying ${wasm.length} bytes of wasm to ${ACCOUNT} (testnet)`);
const deploy = await sendTx({ ...auth, receiverId: ACCOUNT, actions: [{ type: "deploy", code: wasm }] });
console.log(`deploy tx: ${deploy.txHash}`);
assertSuccess("deploy", deploy.outcome);

const init = await sendTx({
  ...auth,
  receiverId: ACCOUNT,
  actions: [{ type: "functionCall", method: "new", args: POLICY_ARGS, gas: 30_000_000_000_000, deposit: 0 }],
});
console.log(`init tx: ${init.txHash}`);
assertSuccess("init", init.outcome);

const policy = await callView(ACCOUNT, "get_policy");
console.log(`on-chain policy now: ${JSON.stringify(policy)}`);
console.log("DEPLOY OK");
