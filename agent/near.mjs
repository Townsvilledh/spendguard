// Minimal NEAR JSON-RPC client (view calls only — this module never signs).
// Docs: https://docs.near.org/api/rpc/introduction

const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

export async function rpc(method, params, fetchFn = fetch) {
  const res = await fetchFn(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "spendguard", method, params }),
  });
  if (!res.ok) throw new Error(`NEAR RPC ${method} -> ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`NEAR RPC ${method}: ${JSON.stringify(data.error).slice(0, 300)}`);
  return data.result;
}

/** Returns the account object, or null if the account does not exist. */
export async function viewAccount(accountId, fetchFn = fetch) {
  try {
    return await rpc(
      "query",
      { request_type: "view_account", finality: "final", account_id: accountId },
      fetchFn,
    );
  } catch (e) {
    if (String(e.message).includes("does not exist") || String(e.message).includes("UNKNOWN_ACCOUNT")) {
      return null;
    }
    throw e;
  }
}

/** Call a view method on a contract and JSON-parse the result. */
export async function callView(contractId, methodName, args = {}, fetchFn = fetch) {
  const result = await rpc(
    "query",
    {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    },
    fetchFn,
  );
  const bytes = Buffer.from(result.result);
  return JSON.parse(bytes.toString("utf8"));
}
