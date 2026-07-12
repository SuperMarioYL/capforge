import { test } from "node:test";
import assert from "node:assert/strict";
import {
  embedProvenance,
  splitProvenance,
  canonicalSkillMd,
} from "../src/forge/provenance.js";
import { serializeSkill } from "../src/skill/format.js";
import { FORGE_VERSION, type ForgeRecord, type SkillSpec } from "../src/skill/schema.js";
import { verifyMessage } from "../src/forge/sign.js";
import { loadOrCreateKeypair, signMessage } from "../src/forge/sign.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spec: SkillSpec = {
  frontmatter: { name: "slugify", description: "d", tools: ["Bash"] },
  body: "## When\n\ndo the thing.\n\n```bash\necho $1\n```",
  script: "echo $1",
};

function fakeRecord(sig: string, pubkey: string): ForgeRecord {
  return {
    skill: spec,
    origin: {
      task_context: {
        goal: "g",
        available_tools: [],
        available_skills: [],
        example_inputs: ["a"],
        expected_assert: "true",
      },
      observed_at: "2026-07-12T00:00:00.000Z",
      harness: "claude-code",
      agent_version: "test",
    },
    synthesis: { model: "capforge-mock", prompt_hash: "h", synthesized_at: "2026-07-12T00:00:00.000Z" },
    test: { pass: true, traces: [], duration_ms: 0 },
    signature: { algo: "ed25519", pubkey, sig, signed_at: "2026-07-12T00:00:00.000Z" },
    provenance: { forge_version: FORGE_VERSION },
  };
}

test("embed + split round-trips: skill text is byte-identical, record parses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capforge-keys-"));
  const kp = await loadOrCreateKeypair(dir);
  const skillMd = canonicalSkillMd(spec);
  const sig = await signMessage(skillMd, kp.seckey);
  const record = fakeRecord(sig, kp.pubkey);

  const embedded = embedProvenance(skillMd, record);
  assert.ok(embedded.includes("<!-- capforge:provenance -->"));
  assert.ok(embedded.includes("<!-- /capforge:provenance -->"));

  const split = splitProvenance(embedded);
  assert.equal(split.skillMd, skillMd, "extracted skill text must equal the signed canonical text");
  assert.equal(split.record?.signature.sig, sig);
  assert.equal(split.record?.provenance.forge_version, FORGE_VERSION);
});

test("splitProvenance on unsigned text returns record null", () => {
  const md = serializeSkill(spec);
  const split = splitProvenance(md);
  assert.equal(split.record, null);
  assert.equal(split.skillMd, md.replace(/\s+$/, ""));
});

test("signature verifies over the split skill text; tampering breaks it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capforge-keys-"));
  const kp = await loadOrCreateKeypair(dir);
  const skillMd = canonicalSkillMd(spec);
  const sig = await signMessage(skillMd, kp.seckey);
  const record = fakeRecord(sig, kp.pubkey);

  const embedded = embedProvenance(skillMd, record);
  const split = splitProvenance(embedded);
  assert.equal(
    verifyMessage(split.skillMd, record.signature.sig, record.signature.pubkey),
    true,
  );

  // tamper the embedded body, then re-split: extracted text differs -> sig invalid
  const tampered = embedded.replace("do the thing", "do another thing");
  const split2 = splitProvenance(tampered);
  assert.notEqual(split2.skillMd, skillMd);
  assert.equal(
    verifyMessage(split2.skillMd, record.signature.sig, record.signature.pubkey),
    false,
  );
});
