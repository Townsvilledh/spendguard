// On-chain evaluation proof: submit three payment intents to the deployed
// SpendGuard contract on NEAR testnet and read the decision log back.
// Usage: node scripts/onchain-demo.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sendTx } from "./near-tx.mjs";
import { callView } from "../agent/near.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT = process.env.SPENDGUARD_ACCOUNT ?? "spendguard-ethuram.testnet";
const creds = JSON.parse(readFileSync(join(root, ".keys", `${ACCOUNT}.json`), "utf8"));
const auth = { signerId: ACCOUNT, privateKey: creds.private_key, publicKey: creds.public_key };

const base = {
  recipient: "root.near",
  asset_id: "nep141:wrap.near",
  chain: "near",
  slippage_bps: 25,
};
const intents = [
  { ...base, amount_usd_micros: 5_000_000, memo: "on-chain demo: pay data-vendor $5" },
  { ...base, amount_usd_micros: 40_000_000, memo: "on-chain demo: oversized invoice $40" },
  { ...base, recipient: "unknown-vendor.near", amount_usd_micros: 5_000_000, memo: "on-chain demo: stranger" },
];

for (const intent of intents) {
  const r = await sendTx({
    ...auth,
    receiverId: ACCOUNT,
    actions: [{ type: "functionCall", method: "evaluate", args: { intent }, gas: 30_000_000_000_000, deposit: 0 }],
  });
  const ret = r.outcome.status?.SuccessValue
    ? JSON.parse(Buffer.from(r.outcome.status.SuccessValue, "base64").toString("utf8"))
    : null;
  console.log(
    `evaluate tx ${r.txHash}: ${intent.memo} -> ${ret ? (ret.approved ? "APPROVED" : `DENIED [${ret.reasons.join(", ")}]`) : JSON.stringify(r.outcome.status)}`,
  );
}

const count = await callView(ACCOUNT, "decisions_count");
const decisions = await callView(ACCOUNT, "get_decisions", { from_index: 0, limit: 10 });
const spent = await callView(ACCOUNT, "get_spent_today");
console.log(`decisions on-chain: ${count}; spent today (approved only): ${spent} micro-USD`);
for (const d of decisions) {
  console.log(
    `  #${d.index} ${d.approved ? "APPROVED" : "DENIED"} $${(d.amount_usd_micros / 1e6).toFixed(2)} -> ${d.recipient} [${d.reasons.join(", ") || "ok"}]`,
  );
}
console.log("ONCHAIN DEMO OK");
