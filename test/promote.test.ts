import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { forge } from "../src/forge/provenance.js";
import { reviewAndPromote } from "../src/promote/review.js";
import { loadOrCreateKeypair } from "../src/forge/sign.js";
import { keysDir } from "../src/observe/intake.js";
import { slugifyTask, failingTask, mkHome, mkClaudeTarget, cleanup } from "./util.js";

test("m3 promote: a signed skill copies into the target skill dir", async () => {
  const home = await mkHome();
  const target = await mkClaudeTarget();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const r = await forge(slugifyTask, { provider: "auto", model: null }, { home, mock: true });
    assert.equal(r.signed, true);

    const p = await reviewAndPromote(r.id, { home, targetDir: target });
    assert.equal(p.promoted, true);
    assert.equal(p.signed, true);
    assert.equal(p.sig_valid, true);
    assert.equal(p.test_pass, true);

    const dest = join(target, r.id, "SKILL.md");
    const text = await readFile(dest, "utf8");
    assert.ok(text.includes("<!-- capforge:provenance -->"));
  } finally {
    await cleanup(home);
    await cleanup(target);
  }
});

test("m3 promote: an unsigned skill is refused", async () => {
  const home = await mkHome();
  const target = await mkClaudeTarget();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const r = await forge(failingTask, { provider: "auto", model: null }, { home, mock: true });
    assert.equal(r.signed, false);

    const p = await reviewAndPromote(r.id, { home, targetDir: target });
    assert.equal(p.promoted, false);
    assert.ok(p.reason);
    // nothing was written to the target
    await assert.rejects(() => access(join(target, r.id, "SKILL.md")));
  } finally {
    await cleanup(home);
    await cleanup(target);
  }
});
