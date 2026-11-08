// SpendGuard end-to-end demo.
//
// Run:  node demo.mjs
//
// What happens, in order:
//  1. A human-readable name ("data-vendor") is resolved and its NEAR
//     testnet account is verified with a live RPC read.
//  2. A REAL NEAR Intents (1Click) dry-run quote is fetched for a $5
//     wNEAR -> USDT payment. Nothing is signed or sent; the quote is a
//     payload to inspect.
//  3. The quote's own numbers (not the agent's claims) are converted into a
//     PaymentIntent — including slippage measured from the payload — and
//     evaluated by the policy engine.
//  4. A deterministic scenario then exercises every denial rule: per-tx cap,
//     recipient allowlist, slippage, and the daily cap.
//  5. Every decision is written to a hash-chained audit log, which is
//     verified at the end.
//
// Exit code is 0 only if every deterministic assertion passes and the audit
// chain verifies. The live quote's decision is printed but not asserted —
// real market slippage varies; the rules it is judged by do not.

import { PolicyEngine, slippageBpsFromQuote, usd } from "./policy.mjs";
import { getTokens, getDryQuote, findToken } from "./intents.mjs";
import { resolveName, verifyNearName } from "./names.mjs";
import { callView } from "./near.mjs";
import { appendDecision, verifyChain } from "./audit.mjs";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AUDIT_FILE = join(dirname(fileURLToPath(import.meta.url)), "audit-log.jsonl");
rmSync(AUDIT_FILE, { force: true });

const say = (s = "") => console.log(s);
const fmt$ = (micros) => `$${(micros / 1_000_000).toFixed(2)}`;
let failures = 0;
const check = (label, cond) => {
  say(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
};

const POLICY = {
  perTxCapUsdMicros: usd(25),
  dailyCapUsdMicros: usd(60),
  maxSlippageBps: 200,
  allowedRecipients: ["root.near"],
  allowedAssets: ["nep141:wrap.near"],
  allowedChains: ["near"],
};

say("=== SpendGuard demo ===");
say(
  `Policy: per-tx cap ${fmt$(POLICY.perTxCapUsdMicros)}, daily cap ${fmt$(POLICY.dailyCapUsdMicros)}, ` +
    `max slippage ${POLICY.maxSlippageBps} bps, recipients ${JSON.stringify(POLICY.allowedRecipients)}`,
);

// ---- Step 1: name resolution, verified live on NEAR testnet --------------
say("\n[1] Resolve name 'data-vendor' and verify it on NEAR testnet (live RPC)");
const vendor = resolveName("data-vendor");
say(`    data-vendor -> testnet account ${vendor.nearTestnet}`);
try {
  const v = await verifyNearName("data-vendor");
  say(`    RPC view_account(${v.account}) -> exists: ${v.exists}`);
  check("vendor account exists on NEAR testnet", v.exists === true);
} catch (e) {
  say(`    RPC check failed: ${e.message}`);
  check("vendor account exists on NEAR testnet", false);
}

// ---- Step 2: a real 1Click dry quote --------------------------------------
say("\n[2] Fetch a live NEAR Intents (1Click) dry-run quote: $5 of wNEAR -> USDT on NEAR");
const engine = new PolicyEngine(POLICY);
try {
  const tokens = await getTokens();
  const wnear = findToken(tokens, (t) => t.assetId === "nep141:wrap.near");
  const usdt = findToken(tokens, (t) => t.blockchain === "near" && t.symbol === "USDT");
  const amountInRaw = (
    (BigInt(Math.round((5 / wnear.price) * 1_000_000)) * 10n ** BigInt(wnear.decimals)) /
    1_000_000n
  ).toString();
  const quoteRes = await getDryQuote({
    originAsset: wnear.assetId,
    destinationAsset: usdt.assetId,
    amountRaw: amountInRaw,
    recipient: vendor.intentsRecipient,
    refundTo: vendor.intentsRecipient,
    slippageToleranceBps: POLICY.maxSlippageBps,
  });
  const q = quoteRes.quote;
  const amountInUsd = q.amountInUsd ? Number(q.amountInUsd) : 5;
  const slippageBps = slippageBpsFromQuote({
    amountInUsd,
    amountOutRaw: q.amountOut,
    outDecimals: usdt.decimals,
    outPriceUsd: usdt.price,
  });
  say(
    `    quote: in ${q.amountInFormatted ?? amountInRaw} wNEAR ($${amountInUsd.toFixed(2)}), ` +
      `out ${q.amountOutFormatted ?? q.amountOut} USDT, measured slippage ${slippageBps} bps, ` +
      `time estimate ${q.timeEstimate ?? "?"}s`,
  );

  // ---- Step 3: evaluate the live payload ----------------------------------
  say("\n[3] Evaluate the live quote payload against the policy");
  const liveIntent = {
    recipient: vendor.intentsRecipient,
    assetId: wnear.assetId,
    chain: wnear.blockchain,
    amountUsdMicros: usd(amountInUsd),
    slippageBps,
    memo: "live 1Click dry quote: pay data-vendor $5",
  };
  const liveDecision = engine.evaluate(liveIntent);
  appendDecision(AUDIT_FILE, { kind: "live-quote", intent: liveIntent, ...liveDecision });
  say(
    `    -> ${liveDecision.approved ? "APPROVED" : "DENIED"} ` +
      `(reasons: ${liveDecision.reasons.length ? liveDecision.reasons.join(", ") : "none"}; ` +
      `spent today after: ${fmt$(liveDecision.spentTodayAfterUsdMicros)})`,
  );
  say("    (printed, not asserted: live slippage varies, the rules do not)");
} catch (e) {
  say(`    live quote unavailable: ${e.message}`);
  say("    continuing with the deterministic scenario");
}

// ---- Step 4: deterministic scenario ---------------------------------------
say("\n[4] Deterministic scenario against a fresh daily budget");
const s = new PolicyEngine(POLICY);
const base = {
  recipient: vendor.intentsRecipient,
  assetId: "nep141:wrap.near",
  chain: "near",
  slippageBps: 25,
  memo: "scenario",
};
const run = (label, intent, expectApproved, expectReasons = []) => {
  const d = s.evaluate(intent);
  appendDecision(AUDIT_FILE, { kind: "scenario", label, intent, ...d });
  say(
    `    ${label}: ${d.approved ? "APPROVED" : "DENIED"} ` +
      `[${d.reasons.join(", ") || "ok"}] spent today: ${fmt$(d.spentTodayAfterUsdMicros)}`,
  );
  check(`${label} decision`, d.approved === expectApproved);
  check(`${label} reasons`, JSON.stringify(d.reasons) === JSON.stringify(expectReasons));
};

run("S1 pay vendor $5", { ...base, amountUsdMicros: usd(5), memo: "data API invoice #1" }, true);
run("S2 invoice $40", { ...base, amountUsdMicros: usd(40), memo: "oversized invoice" }, false, [
  "PER_TX_CAP_EXCEEDED",
]);
run(
  "S3 pay a stranger $5",
  { ...base, recipient: "unknown-vendor.near", amountUsdMicros: usd(5), memo: "unlisted payee" },
  false,
  ["RECIPIENT_NOT_ALLOWED"],
);
run(
  "S4 quote with 450 bps slippage",
  { ...base, amountUsdMicros: usd(5), slippageBps: 450, memo: "bad quote" },
  false,
  ["SLIPPAGE_TOO_HIGH"],
);
run("S5a pay vendor $25", { ...base, amountUsdMicros: usd(25), memo: "hosting" }, true);
run("S5b pay vendor $25", { ...base, amountUsdMicros: usd(25), memo: "compute" }, true);
run("S6 one payment too many", { ...base, amountUsdMicros: usd(10), memo: "over the day" }, false, [
  "DAILY_CAP_EXCEEDED",
]);

// ---- Step 5: optional on-chain read ---------------------------------------
const contractId = process.env.SPENDGUARD_CONTRACT;
if (contractId) {
  say(`\n[5] Read the on-chain policy from ${contractId} (NEAR testnet)`);
  try {
    const onChain = await callView(contractId, "get_policy");
    const count = await callView(contractId, "decisions_count");
    say(`    on-chain policy: ${JSON.stringify(onChain)}`);
    say(`    on-chain decisions logged so far: ${count}`);
  } catch (e) {
    say(`    on-chain read failed: ${e.message}`);
  }
} else {
  say("\n[5] SPENDGUARD_CONTRACT not set — skipping on-chain read (see scripts/deploy.sh)");
}

// ---- Audit verification ----------------------------------------------------
say("\n[6] Verify the hash-chained audit log");
check("audit chain verifies", verifyChain(AUDIT_FILE));

say(failures === 0 ? "\nDEMO OK — all checks passed" : `\nDEMO FAILED — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
