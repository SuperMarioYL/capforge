import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { forge, verifySkill, listForgedSkills, splitProvenance } from "../src/forge/provenance.js";
import { loadOrCreateKeypair } from "../src/forge/sign.js";
import { keysDir, skillDir } from "../src/observe/intake.js";
import { slugifyTask, failingTask, mkHome, cleanup } from "./util.js";

test("m1+m2 happy path: mock forge -> verify reports test-pass + signature-valid", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const r = await forge(slugifyTask, { provider: "auto", model: null }, { home, mock: true });
    assert.equal(r.signed, true, "a passing skill must be signed");
    assert.equal(r.test.pass, true);
    assert.ok(r.record);

    const v = await verifySkill(r.id, home);
    assert.equal(v.signed, true);
    assert.equal(v.test_pass, true);
    assert.equal(v.sig_valid, true);
    assert.equal(v.pubkey, r.record?.signature.pubkey);

    const list = await listForgedSkills(home);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, r.id);
    assert.equal(list[0].signed, true);
    assert.equal(list[0].sig_valid, true);
    assert.equal(list[0].test_pass, true);
  } finally {
    await cleanup(home);
  }
});

test("m2 test gate: a skill that fails its own test is never signed", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const r = await forge(failingTask, { provider: "auto", model: null }, { home, mock: true });
    assert.equal(r.signed, false, "a failing skill must NOT be signed");
    assert.equal(r.test.pass, false);
    assert.equal(r.record, null);

    const v = await verifySkill(r.id, home);
    assert.equal(v.signed, false);
    assert.equal(v.test_pass, false);
    assert.equal(v.sig_valid, false);
  } finally {
    await cleanup(home);
  }
});

test("tamper-evidence: editing the signed SKILL.md body breaks verify", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const r = await forge(slugifyTask, { provider: "auto", model: null }, { home, mock: true });
    const skillPath = join(skillDir(r.id, home), "SKILL.md");
    const original = await readFile(skillPath, "utf8");
    const { skillMd } = splitProvenance(original);
    assert.equal(
      (await verifySkill(r.id, home)).sig_valid,
      true,
      "baseline: signature is valid before tampering",
    );

    // edit a byte of the signed body (between frontmatter and the provenance block)
    const tampered = original.replace(skillMd.slice(20, 40), "x".repeat(20));
    await writeFile(skillPath, tampered, "utf8");
    const after = await verifySkill(r.id, home);
    assert.equal(after.sig_valid, false, "tampering the body must invalidate the signature");
    assert.equal(after.signed, true, "the provenance block still parses (signed=true), but sig is invalid");
  } finally {
    await cleanup(home);
  }
});
