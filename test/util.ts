import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskContext } from "../src/skill/schema.js";

/** A throwaway ~/.capforge in the OS temp dir. */
export async function mkHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capforge-home-"));
  await mkdir(join(dir, "keys"), { recursive: true });
  await mkdir(join(dir, "skills"), { recursive: true });
  return dir;
}

export async function cleanup(home: string): Promise<void> {
  await rm(home, { recursive: true, force: true });
}

/** A throwaway ~/.claude/skills target. */
export async function mkClaudeTarget(): Promise<string> {
  return mkdtemp(join(tmpdir(), "capforge-claude-"));
}

/** A real, demo-shaped task the mock synthesizer's slugify script passes. */
export const slugifyTask: TaskContext = {
  goal: "slugify a string",
  available_tools: ["Bash", "Read", "Write"],
  available_skills: [],
  example_inputs: ["Hello World", "Foo Bar Baz!", "Café Résumé"],
  expected_assert: '[ -n "$OUTPUT" ] && case "$OUTPUT" in *[!a-z0-9-]*) false;; esac',
};

/** A task whose assert the mock slugify script cannot satisfy (forces a fail). */
export const failingTask: TaskContext = {
  goal: "always emit the literal OK",
  available_tools: ["Bash"],
  available_skills: [],
  example_inputs: ["anything"],
  expected_assert: '[ "$OUTPUT" = "OK" ]',
};
