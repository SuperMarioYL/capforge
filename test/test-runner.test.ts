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

const hangScript = [
  "#!/usr/bin/env sh",
  "trap '' TERM",
  "while true; do :; done",
  "",
].join("\n");

test("runSkillTest (fix-timeout-exit-zero-false-pass): a hung skill times out and is never reported as passing", async () => {
  // A hanging script with a short timeout. With execa reject:false a timeout
  // RESOLVES with exitCode===undefined and timedOut===true; the old
  // `r.exitCode ?? 0` coerced it to exit 0, so an assert keyed on [ "$EXIT" = 0 ]
  // passed and the skill was signed. The fix maps a timeout to exit 124 and
  // forces assert_pass=false so a hung skill never passes (m2 gate).
  const t = task('[ "$EXIT" = 0 ]');
  const r = await runSkillTest(spec(hangScript), t, { timeoutMs: 800 });
  assert.equal(r.pass, false, "a timed-out skill must not pass overall");
  assert.equal(r.traces.length, 2);
  for (const tr of r.traces) {
    assert.equal(tr.assert_pass, false, "a timed-out example must fail the assert");
    assert.equal(tr.exit_code, 124, "a timeout must report exit 124, not 0");
  }
});

// v0.7.0 fix-spawn-failure-exit-zero-false-pass: with reject:false execa also
// RESOLVES a spawn failure (a script that cannot execute) with failed:true and
// exitCode:undefined. The v0.2.0 fix covered the timeout path, but
// `r.exitCode ?? 0` still coerced a script that never ran to EXIT=0 with empty
// output, so an assert tolerating empty output signed an unexecutable skill.
// A spawn failure is now a failed run: exit 126, forced assert failure, and
// the reason in the trace stderr.

// Deterministic spawn failure on every platform: the shebang interpreter does
// not exist, so execve fails with ENOENT (no shell fallback — glibc execvp's
// sh-fallback only covers ENOEXEC).
const missingInterpreterScript = [
  "#!/nonexistent-capforge-interpreter",
  'printf "%s" "$1"',
  "",
].join("\n");

test("runSkillTest (fix-spawn-failure-exit-zero-false-pass): a script that cannot execute is never reported as passing", async () => {
  // an assert that tolerates empty output with EXIT=0 — exactly the shape
  // that used to pass on the coerced exit code
  const t = task('[ "$EXIT" = 0 ]');
  const r = await runSkillTest(spec(missingInterpreterScript), t);
  assert.equal(r.pass, false, "an unexecutable skill must not pass overall");
  assert.equal(r.traces.length, 2);
  for (const tr of r.traces) {
    assert.equal(tr.assert_pass, false, "a spawn-failed example must fail the assert");
    assert.equal(tr.exit_code, 126, "a spawn failure must report 126, not 0");
    assert.match(tr.stderr, /\[spawn\]/, "the trace must name the spawn failure");
  }
});

// The originally reproduced manifestation: a shebang-less script. On macOS/BSD
// execvp reports ENOEXEC (spawn failure — the false-pass above); on Linux,
// glibc execvp falls back to running the file via /bin/sh, so the script can
// legitimately run there and this test's spawn-failure contract does not apply.
const shebangLessScript = [
  'printf "%s" "$1"',
  "",
].join("\n");

test("runSkillTest (fix-spawn-failure-exit-zero-false-pass): a shebang-less script that exec refuses is never reported as passing", { skip: process.platform === "linux" && "linux execvp runs shebang-less scripts via /bin/sh (no spawn failure to assert)" }, async () => {
  const taskCtx = task('[ "$EXIT" = 0 ]');
  const r = await runSkillTest(spec(shebangLessScript), taskCtx);
  assert.equal(r.pass, false, "an unexecutable skill must not pass overall");
  for (const tr of r.traces) {
    assert.equal(tr.assert_pass, false, "a spawn-failed example must fail the assert");
    assert.equal(tr.exit_code, 126, "a spawn failure must report 126, not 0");
    assert.match(tr.stderr, /\[spawn\]/, "the trace must name the spawn failure");
  }
});
