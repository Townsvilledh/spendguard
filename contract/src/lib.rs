//! SpendGuard — an on-chain policy firewall for AI agent spending.
//!
//! The owner (a human) stores a spending policy in this contract. An agent
//! that wants to move money first submits the *actual payment payload* (a
//! PaymentIntent: recipient, asset, chain, USD value, expected slippage) to
//! `evaluate`. The contract checks the payload against the policy, records
//! the decision in a permanent on-chain log, and only counts approved
//! amounts against the daily budget. A signer/runner should execute a
//! payment if and only if `evaluate` approved it — the agent's own claim
//! about what a payment is counts for nothing; the payload is inspected.
//!
//! Amounts are USD micro-units (1 USD = 1_000_000) so one policy can govern
//! payments in any asset on any chain (e.g. NEAR Intents / 1Click quotes).

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near_bindgen, AccountId, PanicOnDefault};
use std::collections::HashMap;

pub const REASON_RECIPIENT_NOT_ALLOWED: &str = "RECIPIENT_NOT_ALLOWED";
pub const REASON_ASSET_NOT_ALLOWED: &str = "ASSET_NOT_ALLOWED";
pub const REASON_CHAIN_NOT_ALLOWED: &str = "CHAIN_NOT_ALLOWED";
pub const REASON_PER_TX_CAP: &str = "PER_TX_CAP_EXCEEDED";
pub const REASON_DAILY_CAP: &str = "DAILY_CAP_EXCEEDED";
pub const REASON_SLIPPAGE: &str = "SLIPPAGE_TOO_HIGH";

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    /// Max USD value (micro-units) of a single payment. 0 = no limit.
    pub per_tx_cap_usd_micros: u128,
    /// Max total USD value (micro-units) approved per UTC day. 0 = no limit.
    pub daily_cap_usd_micros: u128,
    /// Max acceptable slippage on a swap quote, in basis points.
    pub max_slippage_bps: u32,
    /// Recipient allowlist (NEAR accounts or external-chain addresses).
    /// Empty = any recipient allowed.
    pub allowed_recipients: Vec<String>,
    /// Asset allowlist, as 1Click/NEAR Intents asset ids
    /// (e.g. "nep141:wrap.near"). Empty = any asset allowed.
    pub allowed_assets: Vec<String>,
    /// Chain allowlist (e.g. "near", "base", "sol"). Empty = any chain.
    pub allowed_chains: Vec<String>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct PaymentIntent {
    pub recipient: String,
    pub asset_id: String,
    pub chain: String,
    /// USD value of the payment, micro-units, computed from a live quote.
    pub amount_usd_micros: u128,
    /// Expected slippage of the underlying quote, basis points.
    pub slippage_bps: u32,
    /// Human-readable purpose, stored with the decision for audit.
    pub memo: String,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Decision {
    pub index: u64,
    pub caller: AccountId,
    pub recipient: String,
    pub asset_id: String,
    pub chain: String,
    pub amount_usd_micros: u128,
    pub slippage_bps: u32,
    pub memo: String,
    pub approved: bool,
    /// Machine-readable reason codes; empty iff approved.
    pub reasons: Vec<String>,
    /// UTC day number (days since epoch) the decision belongs to.
    pub day: u64,
    /// Total approved spend for `day` after this decision, micro-units.
    pub spent_today_after_usd_micros: u128,
    pub timestamp_ms: u64,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct SpendGuard {
    owner: AccountId,
    policy: Policy,
    // Prototype scale: decisions are kept in a state Vec. A production
    // version would page them into a store::Vector / UnorderedMap.
    decisions: Vec<Decision>,
    spent_by_day: HashMap<u64, u128>,
}

pub fn current_day() -> u64 {
    // env::block_timestamp_ms exists in near-sdk 5.x; fall back to ns/1e6.
    env::block_timestamp_ms() / 86_400_000
}

/// Pure policy evaluation — shared by `evaluate` and the unit tests, and
/// mirrored line-for-line by the TypeScript pre-check in `agent/policy.mjs`.
pub fn check_policy(
    policy: &Policy,
    intent: &PaymentIntent,
    spent_today_usd_micros: u128,
) -> Vec<String> {
    let mut reasons = Vec::new();
    if !policy.allowed_recipients.is_empty()
        && !policy.allowed_recipients.contains(&intent.recipient)
    {
        reasons.push(REASON_RECIPIENT_NOT_ALLOWED.to_string());
    }
    if !policy.allowed_assets.is_empty() && !policy.allowed_assets.contains(&intent.asset_id) {
        reasons.push(REASON_ASSET_NOT_ALLOWED.to_string());
    }
    if !policy.allowed_chains.is_empty() && !policy.allowed_chains.contains(&intent.chain) {
        reasons.push(REASON_CHAIN_NOT_ALLOWED.to_string());
    }
    if policy.per_tx_cap_usd_micros > 0 && intent.amount_usd_micros > policy.per_tx_cap_usd_micros {
        reasons.push(REASON_PER_TX_CAP.to_string());
    }
    if policy.daily_cap_usd_micros > 0
        && spent_today_usd_micros + intent.amount_usd_micros > policy.daily_cap_usd_micros
    {
        reasons.push(REASON_DAILY_CAP.to_string());
    }
    if intent.slippage_bps > policy.max_slippage_bps {
        reasons.push(REASON_SLIPPAGE.to_string());
    }
    reasons
}

#[near_bindgen]
impl SpendGuard {
    #[init]
    pub fn new(owner: AccountId, policy: Policy) -> Self {
        assert!(!env::state_exists(), "already initialised");
        Self {
            owner,
            policy,
            decisions: Vec::new(),
            spent_by_day: HashMap::new(),
        }
    }

    /// Replace the policy. Owner only: an agent must never be able to
    /// loosen its own leash.
    pub fn set_policy(&mut self, policy: Policy) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "only the owner can change the policy"
        );
        self.policy = policy;
    }

    /// Evaluate a payment payload against the policy, log the decision
    /// on-chain, and (if approved) count it against today's budget.
    /// Returns the full Decision so the caller/runner can verify approval.
    pub fn evaluate(&mut self, intent: PaymentIntent) -> Decision {
        let day = current_day();
        let spent_before = *self.spent_by_day.get(&day).unwrap_or(&0);
        let reasons = check_policy(&self.policy, &intent, spent_before);
        let approved = reasons.is_empty();
        let spent_after = if approved {
            spent_before + intent.amount_usd_micros
        } else {
            spent_before
        };
        if approved {
            self.spent_by_day.insert(day, spent_after);
        }
        let decision = Decision {
            index: self.decisions.len() as u64,
            caller: env::predecessor_account_id(),
            recipient: intent.recipient.clone(),
            asset_id: intent.asset_id.clone(),
            chain: intent.chain.clone(),
            amount_usd_micros: intent.amount_usd_micros,
            slippage_bps: intent.slippage_bps,
            memo: intent.memo.clone(),
            approved,
            reasons,
            day,
            spent_today_after_usd_micros: spent_after,
            timestamp_ms: env::block_timestamp_ms(),
        };
        self.decisions.push(decision.clone());
        decision
    }

    // ---- views ------------------------------------------------------------

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn decisions_count(&self) -> u64 {
        self.decisions.len() as u64
    }

    pub fn get_decision(&self, index: u64) -> Option<Decision> {
        self.decisions.get(index as usize).cloned()
    }

    pub fn get_decisions(&self, from_index: u64, limit: u64) -> Vec<Decision> {
        (from_index..std::cmp::min(from_index + limit, self.decisions.len() as u64))
            .filter_map(|i| self.decisions.get(i as usize).cloned())
            .collect()
    }

    pub fn get_spent_on_day(&self, day: u64) -> u128 {
        *self.spent_by_day.get(&day).unwrap_or(&0)
    }

    pub fn get_spent_today(&self) -> u128 {
        self.get_spent_on_day(current_day())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> Policy {
        Policy {
            per_tx_cap_usd_micros: 25_000_000,  // $25
            daily_cap_usd_micros: 60_000_000,   // $60
            max_slippage_bps: 100,              // 1%
            allowed_recipients: vec!["api-vendor.near".to_string()],
            allowed_assets: vec!["nep141:wrap.near".to_string()],
            allowed_chains: vec!["near".to_string()],
        }
    }

    fn intent(amount: u128) -> PaymentIntent {
        PaymentIntent {
            recipient: "api-vendor.near".to_string(),
            asset_id: "nep141:wrap.near".to_string(),
            chain: "near".to_string(),
            amount_usd_micros: amount,
            slippage_bps: 10,
            memo: "test".to_string(),
        }
    }

    #[test]
    fn approves_a_payment_inside_every_limit() {
        assert!(check_policy(&policy(), &intent(10_000_000), 0).is_empty());
    }

    #[test]
    fn denies_over_per_tx_cap() {
        let r = check_policy(&policy(), &intent(26_000_000), 0);
        assert_eq!(r, vec![REASON_PER_TX_CAP.to_string()]);
    }

    #[test]
    fn denies_when_daily_cap_would_break() {
        // $50 already spent today + $11 new > $60 daily cap (but under $25/tx)
        let r = check_policy(&policy(), &intent(11_000_000), 50_000_000);
        assert_eq!(r, vec![REASON_DAILY_CAP.to_string()]);
    }

    #[test]
    fn denies_unlisted_recipient_asset_and_chain() {
        let mut i = intent(1_000_000);
        i.recipient = "stranger.near".to_string();
        i.asset_id = "nep141:scam.near".to_string();
        i.chain = "sol".to_string();
        let r = check_policy(&policy(), &i, 0);
        assert_eq!(
            r,
            vec![
                REASON_RECIPIENT_NOT_ALLOWED.to_string(),
                REASON_ASSET_NOT_ALLOWED.to_string(),
                REASON_CHAIN_NOT_ALLOWED.to_string()
            ]
        );
    }

    #[test]
    fn denies_high_slippage_quote() {
        let mut i = intent(1_000_000);
        i.slippage_bps = 450;
        let r = check_policy(&policy(), &i, 0);
        assert_eq!(r, vec![REASON_SLIPPAGE.to_string()]);
    }

    #[test]
    fn empty_allowlists_mean_any() {
        let mut p = policy();
        p.allowed_recipients.clear();
        p.allowed_assets.clear();
        p.allowed_chains.clear();
        let mut i = intent(1_000_000);
        i.recipient = "anyone.near".to_string();
        i.chain = "base".to_string();
        assert!(check_policy(&p, &i, 0).is_empty());
    }
}
