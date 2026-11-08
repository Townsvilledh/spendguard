// Tamper-evident audit log: an append-only JSONL file where every entry
// carries the SHA-256 hash of the previous entry. Editing or deleting a
// past decision breaks the chain, which `verifyChain` detects. The on-chain
// contract log is the authoritative record; this is the agent's local copy.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, existsSync } from "node:fs";

const canonical = (obj) => JSON.stringify(obj, Object.keys(obj).sort());
const hashOf = (s) => createHash("sha256").update(s).digest("hex");

export function readEntries(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

export function appendDecision(file, decision) {
  const entries = readEntries(file);
  const prevHash = entries.length ? entries[entries.length - 1].hash : "GENESIS";
  const body = { prevHash, ...decision };
  const entry = { ...body, hash: hashOf(canonical(body)) };
  appendFileSync(file, JSON.stringify(entry) + "\n");
  return entry;
}

export function verifyChain(file) {
  const entries = readEntries(file);
  let prevHash = "GENESIS";
  for (const entry of entries) {
    const { hash, ...rest } = entry;
    if (rest.prevHash !== prevHash) return false;
    if (hashOf(canonical(rest)) !== hash) return false;
    prevHash = hash;
  }
  return true;
}
