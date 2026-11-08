# SpendGuard — NEAR Hackathon 2026 build status

## Track chosen
- **Primary: `security` — AI Security & Defense.** The track brief literally asks for
  "spending limits, policy engines, sandboxed wallets… Give AI money without giving
  it the keys to everything." SpendGuard is exactly that: an on-chain policy engine
  that inspects the *actual payment payload* before an agent's money can move.
- **Secondary: `agents` (Agent Economy) and `business` (Autonomous Business)** —
  the same engine is the constraint layer an autonomous business or agent needs.

## Why this concept
Ethuram's Fluid wallet work produced a hard red-team lesson (finding F-01): a
signer that approves the *envelope* (what the agent says a payment is) instead of
the *payload* (what the payment actually does) will eventually be drained.
SpendGuard turns that lesson into a NEAR product: the policy lives in a NEAR
smart contract, and every proposed payment — including live NEAR Intents (1Click)
swap quotes — is evaluated against it on-chain and written to a tamper-evident
decision log before anything is signed.

## Status log
- 2026-11-08 ~07:20 WAT — Read official blog post + live HACKATHON.md (saved to docs/).
  Tooling verified: Rust 1.99 + wasm32 target, near-cli-rs 0.31.1, NEAR testnet RPC live,
  NEAR Intents 1Click API live.
- Build in progress… (updates appended below)
