// NEAR Intents (1Click) client — https://docs.near-intents.org
// Quotes are requested with dry:true, so a quote never moves funds: it is a
// *payload* the policy engine can inspect before anything is signed.
// Without a JWT the standard 1Click fee applies to executed swaps (see
// HACKATHON.md Q-006); quotes themselves are free.

const BASE = process.env.ONECLICK_BASE_URL ?? "https://1click.chaindefuser.com";
const HEADERS = { "User-Agent": "spendguard-demo/0.1 (+https://nearhackathon.com)" };
// Solver quotes can be slow; never let a live quote stall the demo.
const QUOTE_TIMEOUT_MS = Number(process.env.ONECLICK_TIMEOUT_MS ?? 30_000);

export async function getTokens(fetchFn = fetch) {
  const res = await fetchFn(`${BASE}/v0/tokens`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`1Click /v0/tokens -> ${res.status}`);
  return res.json();
}

export function findToken(tokens, predicate) {
  const t = tokens.find(predicate);
  if (!t) throw new Error("token not found in 1Click token list");
  return t;
}

/**
 * Request a dry-run EXACT_INPUT quote.
 * @returns the raw quote response; response.quote carries amountIn/amountOut
 *          (raw integer strings) and amountInUsd/amountOutUsd when present.
 */
export async function getDryQuote(
  { originAsset, destinationAsset, amountRaw, recipient, refundTo, slippageToleranceBps = 100 },
  fetchFn = fetch,
) {
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    depositType: "ORIGIN_CHAIN",
    originAsset,
    destinationAsset,
    amount: String(amountRaw),
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    slippageTolerance: slippageToleranceBps,
    quoteWaitingTimeMs: 3000,
  };
  const res = await fetchFn(`${BASE}/v0/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...HEADERS },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`1Click /v0/quote -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
