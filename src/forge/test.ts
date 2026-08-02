import { execa } from "execa";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillSpec, TaskContext, TestResult, TestTrace } from "../skill/schema.js";

/**
 * test — run the synthesized skill against example_inputs in a throwaway
 * sandbox, then evaluate expected_assert per example. Machine-checkable
 * pass/fail. This is the gate the signature stands behind: a skill that
 * fails its own test is never signed.
 *
 * The skill is a CLI-tool skill (shell wrapper). We extract its script to a
 * temp dir, run it once per example_input with the input as $1, capture
 * stdout, then run expected_assert (a shell expression) with INPUT/OUTPUT/EXIT
 * exposed — exit 0 means that example passed.
 */

export interface TestOptions {
  timeoutMs?: number;
}

export async function runSkillTest(
  spec: SkillSpec,
  task: TaskContext,
  opts: TestOptions = {},
): Promise<TestResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 10_000;

  if (!spec.script) {
    return {
      pass: false,
      traces: [],
      duration_ms: Date.now() - start,
    };
  }

  const tmp = await mkdtemp(join(tmpdir(), "capforge-test-"));
  try {
    const scriptPath = join(tmp, "skill.sh");
    await writeFile(scriptPath, spec.script + "\n", "utf8");
    await chmod(scriptPath, 0o755);

    const traces: TestTrace[] = [];
    for (const input of task.example_inputs) {
      const trace = await runOne(scriptPath, input, task.expected_assert, tmp, timeoutMs);
      traces.push(trace);
    }

    const pass = traces.length > 0 && traces.every((t) => t.assert_pass);
    return { pass, traces, duration_ms: Date.now() - start };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function runOne(
  scriptPath: string,
  input: string,
  assertExpr: string,
  cwd: string,
  timeoutMs: number,
): Promise<TestTrace> {
  let exit_code = 0;
  let stdout = "";
  let stderr = "";
  // v0.2.0 (fix-timeout-exit-zero-false-pass): execa with reject:false makes a
  // timeout RESOLVE (not reject) — r.timedOut===true and r.exitCode===undefined.
  // The old `r.exitCode ?? 0` coerced a hung skill to exit 0, so the assert
  // passed, test.pass became true, and the skill was signed — defeating the m2
  // "never sign a failing skill" gate. Track the timeout and force the assert to
  // fail below so a timed-out example is never reported as passing.
  let timed_out = false;

  try {
    const r = await execa(scriptPath, [input], {
      cwd,
      timeout: timeoutMs,
      reject: false,
      shell: false,
    });
    timed_out = r.timedOut === true;
    exit_code = timed_out ? 124 : (r.exitCode ?? 0);
    stdout = r.stdout ?? "";
    stderr = r.stderr ?? "";
  } catch (e) {
    const err = e as { exitCode?: number; stdout?: string; stderr?: string; message?: string; timedOut?: boolean };
    timed_out = err.timedOut === true;
    exit_code = timed_out ? 124 : (err.exitCode ?? 1);
    stdout = err.stdout ?? "";
    stderr = (err.stderr ?? "") + (timed_out ? "\n[timeout]" : `\n${err.message ?? ""}`);
  }

  let assert_pass = false;
  // A timed-out run must never pass, regardless of what the caller-supplied
  // expected_assert would decide on EXIT=124 — force failure and skip the assert
  // run so a hung skill is never signed.
  if (timed_out) {
    assert_pass = false;
  } else {
    try {
      const a = await execa(assertExpr, [], {
        cwd,
        shell: true,
        timeout: timeoutMs,
        reject: false,
        env: {
          ...process.env,
          INPUT: input,
          OUTPUT: stdout,
          EXIT: String(exit_code),
        },
      });
      assert_pass = a.exitCode === 0;
      if (!assert_pass && (a.stderr || a.stdout)) {
        stderr += `\n[assert] ${(a.stderr || a.stdout).trim()}`;
      }
    } catch {
      assert_pass = false;
    }
  }

  return { input, exit_code, stdout, stderr, assert_pass };
}
