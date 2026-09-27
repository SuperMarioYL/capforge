import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSynthesisPrompt,
  computePromptHash,
  deriveMockName,
  parseSkillOutput,
  resolveProvider,
  synthesizeMock,
} from "../src/forge/synthesize.js";
import { slugifyTask } from "./util.js";

test("synthesizeMock produces a SkillSpec with frontmatter + body + script", () => {
  const spec = synthesizeMock(slugifyTask);
  assert.match(spec.frontmatter.name, /^[a-z0-9-]+$/);
  assert.equal(spec.frontmatter.tools[0], "Bash");
  assert.ok(spec.body.includes("```bash"));
  assert.ok(spec.script && spec.script.includes("printf"));
});

test("parseSkillOutput extracts frontmatter + the bash fence as script", () => {
  const md = `---
name: my-skill
description: does a thing
tools:
  - Bash
---

## When to invoke

When X.

\`\`\`bash
printf "%s" "$1"
\`\`\`
`;
  const spec = parseSkillOutput(md);
  assert.equal(spec.frontmatter.name, "my-skill");
  assert.equal(spec.frontmatter.description, "does a thing");
  assert.deepEqual(spec.frontmatter.tools, ["Bash"]);
  assert.equal(spec.script, 'printf "%s" "$1"');
});

test("buildSynthesisPrompt surfaces the goal and the pass assertion", () => {
  const p = buildSynthesisPrompt(slugifyTask);
  assert.ok(p.includes("slugify a string"));
  assert.ok(p.includes("PASS ASSERTION"));
  assert.ok(p.includes(slugifyTask.expected_assert));
});

test("computePromptHash is a 16-hex-char sha prefix, stable", () => {
  const h = computePromptHash("hello");
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(h, computePromptHash("hello"));
  assert.notEqual(h, computePromptHash("hellp"));
});

test("deriveMockName slugifies a goal", () => {
  assert.equal(deriveMockName("Slugify A String!"), "slugify-a-string");
  assert.equal(deriveMockName(""), "skill");
});

test("resolveProvider: auto prefers ANTHROPIC then OPENAI, else null", () => {
  const savedA = process.env.ANTHROPIC_API_KEY;
  const savedO = process.env.OPENAI_API_KEY;
  const cfg = { provider: "auto" as const, model: null };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    assert.equal(resolveProvider(cfg).provider, null);

    process.env.ANTHROPIC_API_KEY = "sk-test";
    assert.equal(resolveProvider(cfg).provider, "anthropic");
    assert.equal(resolveProvider(cfg).model, "claude-sonnet-4-5");

    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    assert.equal(resolveProvider(cfg).provider, "openai");
    assert.equal(resolveProvider(cfg).model, "gpt-4o");
  } finally {
    if (savedA === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedA;
    if (savedO === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedO;
  }
});

test("synthesize(mock) yields a record-shaped synthesis block", async () => {
  const { synthesize } = await import("../src/forge/synthesize.js");
  const r = await synthesize(slugifyTask, { provider: "auto", model: null }, { mock: true });
  assert.equal(r.synthesis.model, "capforge-mock");
  assert.match(r.synthesis.prompt_hash, /^[0-9a-f]{16}$/);
  assert.ok(r.spec.script);
});

// v0.7.0 fix-forge-provider-http-boundary: opts.provider arrives from the
// network and cfg.provider from an unvalidated config.json (loadConfig spreads
// raw JSON). An unknown value used to fall through as a "forced" provider with
// model = DEFAULT_MODELS[forced] = undefined — an opaque crash deep in the AI
// SDK (no key) or a silent forge via OpenAI (key set). It now throws a
// descriptive error instead of silently mapping the user's intent.
test("resolveProvider (fix-forge-provider-http-boundary): an invalid forced provider throws a descriptive error", () => {
  assert.throws(
    // cfg.provider is unvalidated at loadConfig time — simulate a hand-edited config.json
    () => resolveProvider({ provider: "gemini" as any, model: null }),
    /must be 'anthropic' or 'openai'/,
  );
  assert.throws(
    () => resolveProvider({ provider: "auto", model: null }, { provider: "gemini" as any }),
    /must be 'anthropic' or 'openai'/,
  );
});
