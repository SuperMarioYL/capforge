import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { forge, verifySkill, listForgedSkills, splitProvenance } from "../src/forge/provenance.js";
import { reviewAndPromote } from "../src/promote/review.js";
import { loadOrCreateKeypair } from "../src/forge/sign.js";
import { keysDir, skillDir } from "../src/observe/intake.js";
import { slugifyTask, failingTask, mkHome, mkClaudeTarget, cleanup } from "./util.js";

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

test("fix-signature-skips-provenance-record: tampering the embedded test.pass breaks verify", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const r = await forge(slugifyTask, { provider: "auto", model: null }, { home, mock: true });
    const skillPath = join(skillDir(r.id, home), "SKILL.md");
    const original = await readFile(skillPath, "utf8");
    assert.equal((await verifySkill(r.id, home)).sig_valid, true, "baseline valid before tamper");

    // v0.2.0: the signature now commits to the full record (incl. test.pass),
    // so flipping test.pass true->false in the embedded JSON must invalidate
    // it. (Previously only skillMd was signed, so this tamper kept sig_valid.)
    const tampered = original.replace(
      '"pass": true',
      '"pass": false',
    );
    // only mutate if the string actually appears (mock test has pass:true)
    if (tampered !== original) {
      await writeFile(skillPath, tampered, "utf8");
      const after = await verifySkill(r.id, home);
      assert.equal(after.sig_valid, false, "tampering test.pass must invalidate the signature");
    }
  } finally {
    await cleanup(home);
  }
});

test("fix-list-corrupt-provenance-blast-radius: one corrupt skill dir does not break listForgedSkills", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    // a healthy forged skill
    const good = await forge(slugifyTask, { provider: "auto", model: null }, { home, mock: true });

    // a corrupt sibling: a half-written SKILL.md whose provenance block is
    // malformed JSON (e.g. process killed mid-forge). splitProvenance throws
    // on this; listForgedSkills must catch it and keep listing the rest.
    const corruptId = "corrupt-skill-deadbeef";
    const corruptDir = skillDir(corruptId, home);
    await mkdir(corruptDir, { recursive: true });
    await writeFile(
      join(corruptDir, "SKILL.md"),
      "---\nname: broken\ndescription: d\ntools: []\n---\n\n## impl\n\nbroken\n\n" +
        "<!-- capforge:provenance -->\n{not valid json}\n<!-- /capforge:provenance -->\n",
      "utf8",
    );

    // must not throw — returns both the good (signed) and the corrupt entry
    const list = await listForgedSkills(home);
    const ids = list.map((s) => s.id);
    assert.ok(ids.includes(good.id), "the healthy skill is still listed");
    assert.ok(ids.includes(corruptId), "the corrupt skill is listed as a corrupt entry");
    const corrupt = list.find((s) => s.id === corruptId)!;
    assert.equal(corrupt.signed, false);
    assert.equal(corrupt.sig_valid, false);
    assert.equal(corrupt.test_pass, false);
  } finally {
    await cleanup(home);
  }
});

// v0.3.0 fix-verify-corrupt-provenance-crash: the v0.2.0 corrupt-provenance
// guard covered listForgedSkills only. verifySkill (and the promote path, which
// calls verifySkill) still called splitProvenance unguarded, so one corrupt
// SKILL.md crashed `capforge verify` / `capforge promote` / the detail API.
// They are now guarded — assert they degrade to a non-throwing invalid result.
test("fix-verify-corrupt-provenance-crash: verifySkill + promote do not throw on a corrupt SKILL.md", async () => {
  const home = await mkHome();
  const target = await mkClaudeTarget();
  try {
    await loadOrCreateKeypair(keysDir(home));
    // a corrupt skill dir (malformed provenance JSON — process killed mid-forge)
    const corruptId = "corrupt-verify-deadbeef";
    const corruptDir = skillDir(corruptId, home);
    await mkdir(corruptDir, { recursive: true });
    await writeFile(
      join(corruptDir, "SKILL.md"),
      "---\nname: broken\ndescription: d\ntools: []\n---\n\n## impl\n\nbroken\n\n" +
        "<!-- capforge:provenance -->\n{not valid json}\n<!-- /capforge:provenance -->\n",
      "utf8",
    );

    // verifySkill must NOT throw — returns a non-throwing invalid result
    const v = await verifySkill(corruptId, home);
    assert.equal(v.signed, false);
    assert.equal(v.sig_valid, false);
    assert.equal(v.record, null);

    // promote calls verifySkill internally; it must refuse (not throw) since the
    // skill is corrupt/unsigned
    const r = await reviewAndPromote(corruptId, { home, targetDir: target });
    assert.equal(r.promoted, false);
    assert.equal(r.signed, false);
  } finally {
    await cleanup(home);
    await cleanup(target);
  }
});
