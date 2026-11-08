import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecision, readEntries, verifyChain } from "../audit.mjs";
import { resolveName } from "../names.mjs";

test("audit log is hash-chained and tamper-evident", () => {
  const dir = mkdtempSync(join(tmpdir(), "spendguard-"));
  const file = join(dir, "audit.jsonl");
  appendDecision(file, { index: 0, approved: true, amountUsdMicros: 100 });
  appendDecision(file, { index: 1, approved: false, amountUsdMicros: 200 });
  assert.equal(readEntries(file).length, 2);
  assert.equal(verifyChain(file), true);

  // Tamper with the first entry's amount -> chain must break.
  const lines = readFileSync(file, "utf8").trim().split("\n");
  const first = JSON.parse(lines[0]);
  first.amountUsdMicros = 999;
  writeFileSync(file, [JSON.stringify(first), lines[1]].join("\n") + "\n");
  assert.equal(verifyChain(file), false);
});

test("names resolve to concrete addresses; unknown names throw", () => {
  const v = resolveName("data-vendor");
  assert.equal(v.nearTestnet, "spendguard-ethuram.testnet");
  assert.throws(() => resolveName("nobody"), /unknown name/);
});
