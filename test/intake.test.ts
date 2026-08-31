import { test } from "node:test";
import assert from "node:assert/strict";
import { validSkillId } from "../src/observe/intake.js";

// v0.5.0 fix-cli-skill-id-traversal: v0.4.0 added validSkillId at the HTTP
// handler boundary; v0.5.0 extends it to the CLI commands (cmdVerify /
// cmdPromote) so a raw `../` id can no longer traverse out of the store via
// skillDir=join(skillsDir(home), id). Lock the guard contract that BOTH the
// HTTP and CLI entry points rely on: a traversal payload (containing "/" or
// "." or "..") must never match, and a real deriveSkillId output must always
// match. The CLI receives RAW (not URL-decoded) ids, so assert against the
// raw `../` form the CLI path sees.
test("validSkillId: accepts real forged ids and rejects traversal payloads", () => {
  // real deriveSkillId outputs: <slug>-<8 lowercase hex>
  assert.equal(validSkillId("slugify-a-string-1a2b3c4d"), true);
  assert.equal(validSkillId("skill-deadbeef"), true);
  assert.equal(validSkillId("a1b2c3d4-abcd1234"), true);

  // traversal / non-skill ids must be rejected (no file outside the store
  // is ever read/written for one of these)
  assert.equal(validSkillId("../../.claude/skills/victim"), false);
  assert.equal(validSkillId("../foo"), false);
  assert.equal(validSkillId("../../../etc/passwd"), false);
  assert.equal(validSkillId("victim"), false, "no -<sha8> suffix");
  assert.equal(validSkillId("skill-deadbe"), false, "short hash");
  assert.equal(validSkillId("skill-DEADBEEF"), false, "uppercase hex");
  assert.equal(validSkillId("skill-deadbeef-aaa"), false, "trailing segment");
  assert.equal(validSkillId(""), false);
  assert.equal(validSkillId("."), false);
  assert.equal(validSkillId(".."), false);
});
