// Minimal NEAR transaction builder/signer (ed25519 + Borsh), just enough to
// deploy a contract and call functions without any SDK dependency.
// NEAR tx format: https://nomicon.io/RuntimeSpec/Transactions
import { createHash, createPrivateKey, sign } from "node:crypto";

const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPH.indexOf(c));
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const body = Buffer.from(hex, "hex");
  const zeros = Buffer.alloc([...s].findIndex((c) => c !== "1"));
  return Buffer.concat([zeros, body]);
}
export function b58encode(buf) {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = ALPH[Number(n % 58n)] + out;
    n /= 58n;
  }
  const zeros = buf.findIndex((b) => b !== 0);
  return "1".repeat(zeros === -1 ? buf.length : zeros) + out;
}

class Writer {
  constructor() {
    this.parts = [];
  }
  u8(v) {
    this.parts.push(Buffer.from([v]));
    return this;
  }
  u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    this.parts.push(b);
    return this;
  }
  u64(v) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v));
    this.parts.push(b);
    return this;
  }
  u128(v) {
    const b = Buffer.alloc(16);
    let x = BigInt(v);
    for (let i = 0; i < 16; i++) {
      b[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    this.parts.push(b);
    return this;
  }
  raw(buf) {
    this.parts.push(Buffer.from(buf));
    return this;
  }
  str(s) {
    const b = Buffer.from(s, "utf8");
    return this.u32(b.length).raw(b);
  }
  vecBytes(buf) {
    return this.u32(buf.length).raw(buf);
  }
  done() {
    return Buffer.concat(this.parts);
  }
}

export function publicKeyBytes(pubB58) {
  return b58decode(pubB58.replace(/^ed25519:/, ""));
}

function serializeTx({ signerId, publicKey, nonce, receiverId, blockHash, actions }) {
  const w = new Writer();
  w.str(signerId).u8(0).raw(publicKeyBytes(publicKey)).u64(nonce).str(receiverId).raw(b58decode(blockHash)).u32(actions.length);
  for (const a of actions) {
    if (a.type === "deploy") {
      w.u8(1).vecBytes(a.code);
    } else if (a.type === "functionCall") {
      w.u8(2).str(a.method).vecBytes(Buffer.from(JSON.stringify(a.args))).u64(a.gas).u128(a.deposit ?? 0);
    } else if (a.type === "transfer") {
      w.u8(3).u128(a.deposit);
    } else {
      throw new Error(`unsupported action ${a.type}`);
    }
  }
  return w.done();
}

export function signTx(txBytes, privateKeyB58) {
  const secret = b58decode(privateKeyB58.replace(/^ed25519:/, ""));
  const seed = secret.subarray(0, 32);
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const hash = createHash("sha256").update(txBytes).digest();
  const signature = sign(null, hash, key);
  const w = new Writer();
  w.raw(txBytes).u8(0).raw(signature);
  return w.done();
}

const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "spendguard-tx", method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error).slice(0, 400)}`);
  return data.result;
}

/** Build, sign and broadcast a transaction; resolves with the tx outcome. */
export async function sendTx({ signerId, privateKey, publicKey, receiverId, actions }) {
  const status = await rpc("status", []);
  const blockHash = status.sync_info.latest_block_hash;
  const accessKey = await rpc("query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: signerId,
    public_key: publicKey,
  });
  const nonce = BigInt(accessKey.nonce) + 1n;
  const txBytes = serializeTx({ signerId, publicKey, nonce, receiverId, blockHash, actions });
  const signed = signTx(txBytes, privateKey);
  const txHash = b58encode(createHash("sha256").update(signed).digest());
  const outcome = await rpc("send_tx", {
    signed_tx_base64: signed.toString("base64"),
    wait_until: "EXECUTED_OPTIMISTIC",
  });
  return { txHash, outcome };
}

export function txStatus(outcome) {
  return outcome?.status ?? outcome?.final_execution_status ?? "unknown";
}
