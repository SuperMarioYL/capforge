import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORGE_VERSION,
  TaskContextSchema,
  ForgeRecordSchema,
  SkillSpecSchema,
  deriveSkillId,
  canonicalSkillBytes,
  type SkillSpec,
} from "../src/skill/schema.js";
import { slugifyTask } from "./util.js";

test("FORGE_VERSION is stamped as a 0.x semver", () => {
  assert.match(FORGE_VERSION, /^0\.\d+\.\d+$/);
});

test("TaskContextSchema accepts a well-formed task and defaults optionals", () => {
  const t = TaskContextSchema.parse({
    goal: "x",
    example_inputs: ["a"],
    expected_assert: "true",
  });
  assert.deepEqual(t.available_tools, []);
  assert.deepEqual(t.available_skills, []);
});

test("TaskContextSchema rejects a task without example_inputs", () => {
  assert.throws(() =>
    TaskContextSchema.parse({ goal: "x", expected_assert: "true" }),
  );
});

test("SkillSpecSchema rejects a bodyless spec", () => {
  assert.throws(() =>
    SkillSpecSchema.parse({
      frontmatter: { name: "x", description: "y", tools: [] },
      body: "",
    }),
  );
});

test("deriveSkillId is slug-safe and stable", () => {
  const spec: SkillSpec = {
    frontmatter: { name: "Slugify A String!", description: "d", tools: ["Bash"] },
    body: "body",
    script: "echo hi",
  };
  const a = deriveSkillId(spec);
  const b = deriveSkillId(spec);
  assert.equal(a, b);
  assert.match(a, /^[a-z0-9-]+-[0-9a-f]{8}$/);
  assert.ok(!a.includes(" "));
  assert.ok(!a.includes("!"));
});

test("canonicalSkillBytes is deterministic for the same spec", () => {
  const spec: SkillSpec = {
    frontmatter: { name: "n", description: "d", tools: ["Bash"] },
    body: "b",
    script: "s",
  };
  assert.equal(canonicalSkillBytes(spec), canonicalSkillBytes(spec));
  assert.ok(canonicalSkillBytes(spec).includes('"name":"n"'));
});

test("ForgeRecordSchema round-trips a full record", () => {
  const record = {
    skill: {
      frontmatter: { name: "n", description: "d", tools: ["Bash"] },
      body: "b",
      script: "echo $1",
    },
    origin: {
      task_context: slugifyTask,
      observed_at: "2026-07-12T00:00:00.000Z",
      harness: "claude-code",
      agent_version: "test",
    },
    synthesis: { model: "capforge-mock", prompt_hash: "deadbeef", synthesized_at: "2026-07-12T00:00:00.000Z" },
    test: { pass: true, traces: [], duration_ms: 1 },
    signature: { algo: "ed25519", pubkey: "pk", sig: "sg", signed_at: "2026-07-12T00:00:00.000Z" },
    provenance: { forge_version: FORGE_VERSION },
  };
  const parsed = ForgeRecordSchema.parse(record);
  assert.equal(parsed.origin.harness, "claude-code");
  assert.equal(parsed.provenance.forge_version, FORGE_VERSION);
});
