# SpendGuard

**Give AI money without giving it the keys to everything.**

An on-chain policy firewall for AI agent spending, built for
[NEAR HACKATHON: Build Beyond Boundaries](https://nearhackathon.com)
(1–14 Nov 2026).

- **Primary track: `security` — AI Security & Defense** (spending limits,
  policy engines, sandboxed wallets).
- Also fits: `agents` (Agent Economy) and `business` (Autonomous Business) —
  this is the constraint layer those agents need before they can be trusted
  with a treasury.

## The problem

Agents are starting to hold wallets and pay for things: APIs, compute, data,
other agents. The standard failure mode is a signer that approves what the
agent *says* a payment is — the envelope — instead of what the payment
*actually does* — the payload. One manipulated quote, one swapped recipient,
one "small" payment repeated 400 times, and the wallet is empty. Prompt-level
guardrails ("please don't overspend") are not a control; they are a hope.

## What SpendGuard does

The human owner stores a spending policy in a **NEAR smart contract**:
per-transaction cap, daily cap, max quote slippage, and allowlists for
recipients, assets and chains (amounts in USD micro-units, so one policy
governs payments in any asset on any chain).

Before money can move, the payment **payload** is submitted to the
contract's `evaluate` method. The contract checks the payload itself —
recipient, asset, chain, USD value computed from a live quote, and slippage
*measured from the quote's own numbers* — records the decision in a
permanent on-chain log, and counts only approved amounts against the daily
budget. A runner executes a payment **iff** `evaluate` approved it. The
agent cannot loosen its own leash: `set_policy` is owner-only.

Around the contract sits a small agent runtime that:

- fetches **real NEAR Intents (1Click) dry-run quotes** and converts them
  into payment intents (slippage derived from the payload, never claimed);
- resolves **human-readable names to addresses** before checking them
  (the allowlist stores resolved addresses, so a name is never a loophole);
- pre-checks intents with a line-for-line local mirror of the contract
  rules, so no gas is wasted on payments the contract would deny;
- keeps a **hash-chained local audit log** — edit any past decision and
  the chain breaks.

## Try it (do X → see Y)

Requirements: Node ≥ 20. No `npm install` — the agent runtime has **zero
dependencies**. Testnet reads are live; no keys are needed for steps 1–2.

### 1. Run the tests

```sh
cd agent && npm test
```

→ See **10 tests pass**: approval inside the limits; denial of over-cap,
over-daily-budget, unlisted recipient/asset/chain and high-slippage
payments; daily budget resets at UTC midnight; denials don't consume
budget; slippage is measured from the quote payload; the audit chain
detects tampering.

### 2. Run the end-to-end demo

```sh
cd agent && SPENDGUARD_CONTRACT=spendguard-ethuram.testnet node demo.mjs
```

→ See, in order:

1. The name `data-vendor` resolved and its NEAR testnet account verified
   with a **live RPC read** (`exists: true`).
2. A **live NEAR Intents (1Click) dry-run quote** for $5 of wNEAR → USDT
   (dry quotes move no funds), with slippage measured from the quote
   payload (typically a few bps).
3. That live payload **evaluated against the policy** → APPROVED, with the
   day's spend updated.
4. A deterministic scenario exercising every rule:
   $5 to the vendor **APPROVED** · a $40 invoice **DENIED
   (PER_TX_CAP_EXCEEDED)** · $5 to a stranger **DENIED
   (RECIPIENT_NOT_ALLOWED)** · a 450 bps quote **DENIED
   (SLIPPAGE_TOO_HIGH)** · two $25 payments **APPROVED** · the next one
   **DENIED (DAILY_CAP_EXCEEDED)**.
5. The **on-chain policy read back** from the deployed testnet contract.
6. The hash-chained audit log **verified**. The demo ends with
   `DEMO OK — all checks passed`.

### 3. See the policy enforced on-chain (already deployed)

The contract is live on NEAR testnet at
**`spendguard-ethuram.testnet`**. Its decision log already contains real
evaluations (approvals and denials). Read it with any NEAR RPC client:

```sh
curl -s https://rpc.testnet.near.org -X POST -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":"1","method":"query",
  "params":{"request_type":"call_function","finality":"final",
            "account_id":"spendguard-ethuram.testnet",
            "method_name":"get_decisions",
            "args_base64":"eyJmcm9tX2luZGV4IjowLCJsaW1pdCI6MTB9"}}'
```

→ See the logged decisions: each with caller, recipient, amount, the
approval flag and machine-readable reason codes. Key transactions:
deploy `9YEHM6ZDYYJkKznhVujszdB6nP1RbfQ9TGPXXNdkU1u7`,
init `Eigy8vU6Wau9VJq8vMic4wYAvFrfrLJPdNnWy7Gi4xz6`
(verify on any testnet explorer).

To re-run the on-chain evaluations yourself you need the account key,
which is deliberately **not** in this repo (`.keys/` is gitignored). The
read-only steps above need no key.

### 4. Build the contract

```sh
cd contract && cargo test          # 6 unit tests of the policy rules
cargo build --target wasm32-unknown-unknown --release
```

→ `target/wasm32-unknown-unknown/release/spendguard.wasm`.
`scripts/deploy.mjs` deploys and initialises it (testnet-guarded), and
`scripts/onchain-demo.mjs` submits three intents and prints the on-chain
decision log. Both sign with a small purpose-built NEAR transaction
builder (`scripts/near-tx.mjs`, ~150 lines, no SDK) because the sandbox
used for this build had no TTY for the official CLI's interactive
confirmations.

## Architecture

```
                ┌──────────────────────────── NEAR testnet ───────────────────────────┐
                │  SpendGuard contract (Rust, near-sdk 5.7)                            │
                │  • Policy (owner-only set_policy)                                    │
                │  • evaluate(intent) -> Decision, appended to on-chain log            │
                │  • spent_by_day: only APPROVED amounts consume the daily budget      │
                └──────────────▲───────────────────────────────▲──────────────────────┘
                               │ change call (signed)           │ view calls (RPC)
        ┌──────────────────────┴───────────────┐   ┌────────────┴─────────────────────┐
        │ Runner (executes iff approved)        │   │ Agent runtime (Node, zero deps)  │
        │ — prototype: scripts/onchain-demo.mjs │   │ • intents.mjs  1Click dry quotes │
        └───────────────────────────────────────┘   │ • policy.mjs   local rule mirror │
                                                    │ • names.mjs    name -> address   │
                                                    │ • audit.mjs    hash-chained log  │
                                                    │ • near.mjs     JSON-RPC views    │
                                                    └──────────────────────────────────┘
```

NEAR technologies used: **NEAR smart contract** (policy + decision log),
**NEAR Intents / 1Click API** (cross-chain quote payloads, `dry: true`),
**NEAR JSON-RPC** (account verification, contract views), named testnet
accounts. Roadmap hooks the design already anticipates: function-call
access keys scoped to `evaluate` for the agent (so the agent's key can
*ask* but never *pay* or *re-policy*), and Chain Signatures for executing
approved cross-chain payments.

## Honest limitations

- The prototype's runner stops at the decision: executing an approved
  1Click swap end-to-end (deposit + settlement) is the next build step,
  as is a web UI for owners.
- On-chain decisions are stored in a state `Vec` — fine at prototype
  scale; production would page them into `store` collections.
- The demo's mainnet 1Click quotes are dry runs against a stand-in payee
  (`root.near`) because 1Click simulates payouts and the project's vendor
  account is testnet-only. No mainnet funds exist in this project, by
  design.
- Slippage is measured against 1Click's published token spot prices;
  a production version would use an independent price oracle.

## Origin

SpendGuard generalises a red-team lesson from the author's Fluid wallet
work: *a signer must inspect the payload, not the envelope.* This project
was designed and built during the hackathon window (first commit
2026-11-08); no part of it existed before the event. The Fluid wallet
itself is a separate, pre-existing project and is not part of this
submission.

## What remains for submission day

- [ ] Publish this repository publicly (it is public-ready: no keys, no
      secrets; `.keys/` and build artifacts are gitignored).
- [ ] Record a short demo video/screenshots of step 2 above.
- [ ] Human posts the demo on X tagging @NEARProtocol and #NEARHackathon.
- [ ] Submit once via https://nearhackathon.com/#apply with the repo link,
      the X post link, team size `1`, tracks `security`, `agents`,
      `business`, and a **mainnet** NEAR address for any prize payout.

## License

MIT — see `LICENSE`.
