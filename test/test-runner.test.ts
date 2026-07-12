import { test } from "node:test";
import assert from "node:assert/strict";
import { runSkillTest } from "../src/forge/test.js";
import type { SkillSpec, TaskContext } from "../src/skill/schema.js";

const passingScript = [
  "#!/usr/bin/env sh",
  'printf "%s" "$1"',
  "",
].join("\n");

const upperScript = [
  "#!/usr/bin/env sh",
  'printf "%s" "$1" | tr "a-z" "A-Z"',
  "",
].join("\n");

const task = (assertExpr: string): TaskContext => ({
  goal: "echo input",
  available_tools: ["Bash"],
  available_skills: [],
  example_inputs: ["hello", "world"],
  expected_assert: assertExpr,
});

function spec(script: string): SkillSpec {
  return {
    frontmatter: { name: "n", description: "d", tools: ["Bash"] },
    body: "## impl\n\n```bash\n" + script.trim() + "\n```",
    script,
  };
}

test("runSkillTest: a correct script passes every example", async () => {
  const t = task('[ "$OUTPUT" = "$INPUT" ]');
  const r = await runSkillTest(spec(passingScript), t);
  assert.equal(r.pass, true);
  assert.equal(r.traces.length, 2);
  assert.equal(r.traces[0].stdout, "hello");
  assert.equal(r.traces[1].stdout, "world");
});

test("runSkillTest: a wrong script fails the assert", async () => {
  const t = task('[ "$OUTPUT" = "$INPUT" ]');
  const r = await runSkillTest(spec(upperScript), t);
  assert.equal(r.pass, false);
  assert.equal(r.traces[0].assert_pass, false);
});

test("runSkillTest: a spec with no script fails fast with no traces", async () => {
  const r = await runSkillTest(
    { frontmatter: { name: "n", description: "d", tools: [] }, body: "no script here" },
    task("true"),
  );
  assert.equal(r.pass, false);
  assert.equal(r.traces.length, 0);
});
