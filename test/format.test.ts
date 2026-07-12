import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSkill, parseSkillMarkdown } from "../src/skill/format.js";
import type { SkillSpec } from "../src/skill/schema.js";

const spec: SkillSpec = {
  frontmatter: { name: "slugify", description: "slugify a string", tools: ["Bash"] },
  body: "## When to invoke\n\nWhen you need a slug.\n\n```bash\nprintf %s \"$1\"\n```",
  script: 'printf %s "$1"',
};

test("serializeSkill -> parseSkillMarkdown round-trips frontmatter + body", () => {
  const md = serializeSkill(spec);
  assert.ok(md.startsWith("---"));
  const parsed = parseSkillMarkdown(md);
  assert.equal(parsed.frontmatter.name, "slugify");
  assert.equal(parsed.frontmatter.description, "slugify a string");
  assert.deepEqual(parsed.frontmatter.tools, ["Bash"]);
  assert.ok(parsed.body.includes("## When to invoke"));
  assert.ok(parsed.body.includes('printf %s "$1"'));
});

test("parseSkillMarkdown tolerates a trailing provenance comment", () => {
  const md =
    serializeSkill(spec) +
    "\n\n<!-- capforge:provenance -->\n{}\n<!-- /capforge:provenance -->\n";
  const parsed = parseSkillMarkdown(md);
  assert.equal(parsed.frontmatter.name, "slugify");
});
