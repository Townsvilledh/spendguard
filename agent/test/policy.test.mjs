import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPolicy, PolicyEngine, slippageBpsFromQuote, usd, REASONS } from "../policy.mjs";

const policy = {
  perTxCapUsdMicros: usd(25),
  dailyCapUsdMicros: usd(60),
  maxSlippageBps: 100,
  allowedRecipients: ["vendor.near"],
  allowedAssets: ["nep141:wrap.near"],
  allowedChains: ["near"],
};

const okIntent = {
  recipient: "vendor.near",
  assetId: "nep141:wrap.near",
  chain: "near",
  amountUsdMicros: usd(10),
  slippageBps: 12,
  memo: "pay for data API",
};

test("approves a payment inside every limit", () => {
  assert.deepEqual(checkPolicy(policy, okIntent, 0), []);
});

test("denies over the per-transaction cap", () => {
  assert.deepEqual(checkPolicy(policy, { ...okIntent, amountUsdMicros: usd(26) }, 0), [
    REASONS.PER_TX_CAP,
  ]);
});

test("denies when the daily cap would break", () => {
  assert.deepEqual(checkPolicy(policy, { ...okIntent, amountUsdMicros: usd(11) }, usd(50)), [
    REASONS.DAILY_CAP,
  ]);
});

test("denies unlisted recipient, asset and chain together", () => {
  const r = checkPolicy(
    policy,
    { ...okIntent, recipient: "stranger.near", assetId: "nep141:scam.near", chain: "sol" },
    0,
  );
  assert.deepEqual(r, [REASONS.RECIPIENT_NOT_ALLOWED, REASONS.ASSET_NOT_ALLOWED, REASONS.CHAIN_NOT_ALLOWED]);
});

test("denies a quote whose payload shows high slippage, whatever the agent claims", () => {
  assert.deepEqual(checkPolicy(policy, { ...okIntent, slippageBps: 450 }, 0), [REASONS.SLIPPAGE]);
});

test("engine counts only approved spend against the daily budget", () => {
  const engine = new PolicyEngine(policy, () => 1_700_000_000_000);
  assert.equal(engine.evaluate({ ...okIntent, amountUsdMicros: usd(20) }).approved, true);
  assert.equal(engine.evaluate({ ...okIntent, amountUsdMicros: usd(20) }).approved, true);
  // third $20 would take the day to $60... exactly at cap is fine, one cent over is not
  const third = engine.evaluate({ ...okIntent, amountUsdMicros: usd(20) });
  assert.equal(third.approved, true);
  assert.equal(engine.spentToday(), usd(60));
  const over = engine.evaluate({ ...okIntent, amountUsdMicros: usd(1) });
  assert.equal(over.approved, false);
  assert.deepEqual(over.reasons, [REASONS.DAILY_CAP]);
  assert.equal(engine.spentToday(), usd(60)); // denial did not consume budget
});

test("daily budget resets on a new UTC day", () => {
  let now = 1_700_000_000_000;
  const engine = new PolicyEngine(policy, () => now);
  engine.evaluate({ ...okIntent, amountUsdMicros: usd(25) });
  engine.evaluate({ ...okIntent, amountUsdMicros: usd(25) });
  now += 86_400_000; // next day
  assert.equal(engine.spentToday(), 0);
  assert.equal(engine.evaluate({ ...okIntent, amountUsdMicros: usd(25) }).approved, true);
});

test("slippage is measured from the quote payload, not the claim", () => {
  // $10 in; spot price of output token is $1; quote only delivers 9.6 units.
  const bps = slippageBpsFromQuote({
    amountInUsd: 10,
    amountOutRaw: "9600000",
    outDecimals: 6,
    outPriceUsd: 1,
  });
  assert.equal(bps, 400);
});
