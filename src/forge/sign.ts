import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { nowIso } from "../observe/intake.js";

/**
 * sign — local ed25519. Not a PKI, not a network — a tamper-evident tag so a
 * promoted skill says who forged it and that it passed its own test. ~offline.
 *
 * @noble/ed25519 v2 leaves the sha-512 implementation to the caller; we wire
 * the sync sha512 from @noble/hashes so sign/getPublicKey/verify are hermetic
 * and don't depend on the host's WebCrypto subtle.
 */
(ed.etc as { sha512Sync: unknown }).sha512Sync = sha512;

export interface KeyPair {
  /** hex-encoded ed25519 public key */
  pubkey: string;
  /** hex-encoded ed25519 secret key (never leaves the local store) */
  seckey: string;
}

const PUB_FILE = "ed25519.pub";
const SEC_FILE = "ed25519.sec";

/** Load the local keypair, generating + persisting one on first run. */
export async function loadOrCreateKeypair(keysDir: string): Promise<KeyPair> {
  const pubPath = join(keysDir, PUB_FILE);
  const secPath = join(keysDir, SEC_FILE);
  try {
    const [pubkey, seckey] = await Promise.all([
      readFile(pubPath, "utf8"),
      readFile(secPath, "utf8"),
    ]);
    return { pubkey: pubkey.trim(), seckey: seckey.trim() };
  } catch {
    const seckeyBytes = ed.utils.randomPrivateKey();
    const pubkeyBytes = await ed.getPublicKey(seckeyBytes);
    const seckey = Buffer.from(seckeyBytes).toString("hex");
    const pubkey = Buffer.from(pubkeyBytes).toString("hex");
    await mkdir(keysDir, { recursive: true });
    await writeFile(pubPath, pubkey + "\n", "utf8");
    await writeFile(secPath, seckey + "\n", { encoding: "utf8", mode: 0o600 });
    return { pubkey, seckey };
  }
}

export async function signMessage(
  message: string,
  seckeyHex: string,
): Promise<string> {
  const sig = ed.sign(
    Buffer.from(message, "utf8"),
    Buffer.from(seckeyHex, "hex"),
  );
  return Buffer.from(sig).toString("hex");
}

export function verifyMessage(
  message: string,
  sigHex: string,
  pubkeyHex: string,
): boolean {
  try {
    return ed.verify(
      Buffer.from(sigHex, "hex"),
      Buffer.from(message, "utf8"),
      Buffer.from(pubkeyHex, "hex"),
    );
  } catch {
    return false;
  }
}

/** Sign a SKILL.md blob, returning the signature block fields. */
export async function signSkill(
  skillMd: string,
  keysDir: string,
): Promise<{ pubkey: string; sig: string; signed_at: string }> {
  const kp = await loadOrCreateKeypair(keysDir);
  const sig = await signMessage(skillMd, kp.seckey);
  return { pubkey: kp.pubkey, sig, signed_at: nowIso() };
}
