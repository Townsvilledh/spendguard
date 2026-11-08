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

## Final status — 2026-11-08 ~08:20 WAT — PROTOTYPE COMPLETE, ready for submission day

### What was built: **SpendGuard**
An on-chain policy firewall for AI agent spending. The owner stores a policy
(per-tx cap, daily cap, max slippage, recipient/asset/chain allowlists) in a
NEAR contract; every payment payload — including live NEAR Intents quotes —
must be approved by the contract's `evaluate` before a runner may execute it,
and every decision is logged on-chain. Pitch line: "Give AI money without
giving it the keys to everything." Generalises Fluid's F-01 red-team lesson
(inspect the payload, not the envelope).

### Evidence (all verified by running, 2026-11-08)
- **Contract tests:** `cargo test` — 6/6 pass (approve-in-limits, per-tx cap,
  daily cap, allowlists, slippage, empty-allowlist semantics).
- **Agent tests:** `cd agent && npm test` — 10/10 pass (same rules mirrored
  locally, daily-budget rollover, tamper-evident audit chain, name resolution).
- **Contract DEPLOYED to NEAR testnet:** account/contract
  `spendguard-ethuram.testnet` (created via the NEAR wallet helper with a
  locally generated key; 10 test NEAR; key in `.keys/` 0600, gitignored).
  - deploy tx `9YEHM6ZDYYJkKznhVujszdB6nP1RbfQ9TGPXXNdkU1u7`
  - init tx `Eigy8vU6Wau9VJq8vMic4wYAvFrfrLJPdNnWy7Gi4xz6`
  - policy update tx `HawXHg5wnhwVUS6qUNydVeyztU7zMJxkToU9Ys3knatY`
  - Signing uses a purpose-built ~150-line NEAR tx builder
    (`scripts/near-tx.mjs`) — near-cli-rs's interactive confirmations cannot
    run in this sandbox (no TTY); the CLI binary is kept locally in `tools/`
    (gitignored) but is not needed by the scripts.
- **On-chain enforcement proven:** `node scripts/onchain-demo.mjs` submitted
  real intents; the contract's own log (read back via RPC, see README §3)
  holds 6 decisions — $5 APPROVED ×2, $40 DENIED PER_TX_CAP_EXCEEDED ×2,
  stranger DENIED RECIPIENT_NOT_ALLOWED ×2 — and `get_spent_today` = $10
  (only approved amounts counted).
- **End-to-end demo:** `node demo.mjs` (with SPENDGUARD_CONTRACT set) ends
  "DEMO OK — all checks passed": live testnet RPC name verification, a LIVE
  1Click dry quote ($5 wNEAR→USDT, measured slippage 3 bps) APPROVED by the
  policy, all six deterministic scenario checks, on-chain policy read-back,
  audit-chain verification.
- **Repo:** local git repo on `main`, commit `0dc5a68` — 19 files, no keys,
  no binaries, MIT license, judge-grade README with do-X-see-Y steps.

### Bumps hit and fixed during the build (for the record)
- near-cli-rs faucet returned HTTP 400 through this network → account created
  via the wallet helper API instead.
- near-sdk resolved to 5.30 (API moved) → pinned `=5.7.0`, added direct
  `borsh`/`serde` deps, replaced removed `collections::Vector` with a state
  Vec (documented as a prototype-scale choice).
- 1Click quote hung / 400'd → root causes were `recipientType`
  (must be `DESTINATION_CHAIN`), float formatting of 10²⁴-scale amounts
  (now BigInt), and a non-existent mainnet payee (dry quotes simulate the
  payout; the demo now uses the real `root.near` as stand-in payee and says
  so in the README's limitations).

### What remains (submission day, before 14 Nov 2026 23:59 UTC)
HUMAN STEPS — only Ethuram can do these:
1. **Demo post on X** from his account: built-at-NEAR-HACKATHON post tagging
   @NEARProtocol + #NEARHackathon, with a demo video or screenshots
   (draft text can be prepared by Muse; posting is his).
2. **A mainnet NEAR address** for prize payout (named account or implicit) —
   HACKATHON.md is explicit: never invented by the agent. He creates it in
   any NEAR wallet; it must be a MAINNET address (the testnet one won't do).
3. **Submission form** at https://nearhackathon.com/#apply — needs his name,
   email, and confirmation of the exact payload (project name "SpendGuard",
   team size `1`, tracks `security`, `agents`, `business`, repo URL, X post
   URL, payout address, ~20–2000-char description — a draft description is
   in README form already).
4. **Publish the repo publicly** — currently a local repo at
   ~/workspace/near-hackathon-2026/. Pushing it to a public GitHub repo under
   his account (e.g. Townsvilledh/spendguard) is a step for the parent agent
   to arrange with him; the repo is public-ready as committed.

OPTIONAL POLISH if time allows before 14 Nov: a tiny owner web UI for
setting policy; executing one approved testnet payment end-to-end;
recording the demo video.
