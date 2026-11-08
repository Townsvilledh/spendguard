// SpendGuard policy engine — a line-for-line mirror of the on-chain rules in
// contract/src/lib.rs (`check_policy`). The agent pre-checks locally so it
// doesn't burn gas on payments the contract would deny anyway; the contract
// is the source of truth and re-checks every payload on-chain.
//
// Amounts are USD micro-units (1 USD = 1_000_000) so one policy can govern
// payments in any asset on any chain.

export const REASONS = {
  RECIPIENT_NOT_ALLOWED: "RECIPIENT_NOT_ALLOWED",
  ASSET_NOT_ALLOWED: "ASSET_NOT_ALLOWED",
  CHAIN_NOT_ALLOWED: "CHAIN_NOT_ALLOWED",
  PER_TX_CAP: "PER_TX_CAP_EXCEEDED",
  DAILY_CAP: "DAILY_CAP_EXCEEDED",
  SLIPPAGE: "SLIPPAGE_TOO_HIGH",
};

export const usd = (n) => Math.round(n * 1_000_000);

/**
 * @param {object} policy  {perTxCapUsdMicros, dailyCapUsdMicros, maxSlippageBps,
 *                          allowedRecipients[], allowedAssets[], allowedChains[]}
 * @param {object} intent  {recipient, assetId, chain, amountUsdMicros, slippageBps, memo}
 * @param {number} spentTodayUsdMicros approved spend already counted today
 * @returns {string[]} reason codes; empty array = approved
 */
export function checkPolicy(policy, intent, spentTodayUsdMicros) {
  const reasons = [];
  if (
    policy.allowedRecipients.length > 0 &&
    !policy.allowedRecipients.includes(intent.recipient)
  ) {
    reasons.push(REASONS.RECIPIENT_NOT_ALLOWED);
  }
  if (
    policy.allowedAssets.length > 0 &&
    !policy.allowedAssets.includes(intent.assetId)
  ) {
    reasons.push(REASONS.ASSET_NOT_ALLOWED);
  }
  if (
    policy.allowedChains.length > 0 &&
    !policy.allowedChains.includes(intent.chain)
  ) {
    reasons.push(REASONS.CHAIN_NOT_ALLOWED);
  }
  if (policy.perTxCapUsdMicros > 0 && intent.amountUsdMicros > policy.perTxCapUsdMicros) {
    reasons.push(REASONS.PER_TX_CAP);
  }
  if (
    policy.dailyCapUsdMicros > 0 &&
    spentTodayUsdMicros + intent.amountUsdMicros > policy.dailyCapUsdMicros
  ) {
    reasons.push(REASONS.DAILY_CAP);
  }
  if (intent.slippageBps > policy.maxSlippageBps) {
    reasons.push(REASONS.SLIPPAGE);
  }
  return reasons;
}

/** Stateful daily-budget tracker mirroring the contract's spent_by_day map. */
export class PolicyEngine {
  constructor(policy, now = () => Date.now()) {
    this.policy = policy;
    this.now = now;
    this.spentByDay = new Map();
  }

  day() {
    return Math.floor(this.now() / 86_400_000);
  }

  spentToday() {
    return this.spentByDay.get(this.day()) ?? 0;
  }

  /** Evaluate an intent; approved amounts are counted against today's cap. */
  evaluate(intent) {
    const reasons = checkPolicy(this.policy, intent, this.spentToday());
    const approved = reasons.length === 0;
    if (approved) {
      this.spentByDay.set(this.day(), this.spentToday() + intent.amountUsdMicros);
    }
    return {
      approved,
      reasons,
      day: this.day(),
      spentTodayAfterUsdMicros: this.spentToday(),
    };
  }
}

/**
 * Derive slippage (bps) of a swap quote from the payload itself: compare the
 * quote's actual output against the output the spot prices imply. This is
 * the "inspect the payload, not the envelope" step — an agent claiming
 * "slippage is fine" proves nothing; the quote's numbers are checked.
 */
export function slippageBpsFromQuote({ amountInUsd, amountOutRaw, outDecimals, outPriceUsd }) {
  const amountOut = Number(amountOutRaw) / 10 ** outDecimals;
  const expectedOutUsd = amountInUsd;
  const actualOutUsd = amountOut * outPriceUsd;
  if (expectedOutUsd <= 0 || actualOutUsd <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round(((expectedOutUsd - actualOutUsd) / expectedOutUsd) * 10_000));
}
