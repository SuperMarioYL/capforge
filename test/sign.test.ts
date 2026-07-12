import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOrCreateKeypair,
  signMessage,
  verifyMessage,
} from "../src/forge/sign.js";

test("loadOrCreateKeypair generates + persists a hex keypair", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capforge-keys-"));
  const kp = await loadOrCreateKeypair(dir);
  assert.match(kp.pubkey, /^[0-9a-f]{64}$/);
  assert.match(kp.seckey, /^[0-9a-f]{64}$/);
  // re-load returns the same pair (persisted)
  const kp2 = await loadOrCreateKeypair(dir);
  assert.equal(kp2.pubkey, kp.pubkey);
  assert.equal(kp2.seckey, kp.seckey);
});

test("sign + verify round-trips; a tampered message fails verification", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capforge-keys-"));
  const kp = await loadOrCreateKeypair(dir);
  const msg = "the skill body";
  const sig = await signMessage(msg, kp.seckey);
  assert.equal(verifyMessage(msg, sig, kp.pubkey), true);
  assert.equal(verifyMessage(msg + "!", sig, kp.pubkey), false);
  assert.equal(verifyMessage(msg, "00".repeat(64), kp.pubkey), false);
});
