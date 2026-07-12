import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import type { SkillSpec, Synthesis, TaskContext } from "../skill/schema.js";
import type { CapforgeConfig } from "../observe/intake.js";

/**
 * synthesize — produce a candidate SkillSpec from the task context.
 *
 * Two paths:
 *  - LLM (default): the user's own Anthropic/OpenAI model via the AI SDK, BYO key.
 *  - mock: a deterministic offline synthesizer used when no key is set, in
 *    tests, and in the recorded demo. It is NOT a trained model — it emits a
 *    plausible string-transform skill so the observe→synthesize→test→sign→
 *    provenance loop is exercisable without network or spend.
 *
 * v0.1 synthesizes exactly one skill type: a CLI-tool skill (shell wrapper +
 * SKILL.md). MCP-server / browser-tool synthesis is out of scope.
 */

const DEFAULT_MODELS: Record<"anthropic" | "openai", string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
};

export interface SynthesizeOptions {
  mock?: boolean;
  provider?: "anthropic" | "openai";
  model?: string;
}

export interface SynthesizeResult {
  spec: SkillSpec;
  synthesis: Synthesis;
}

export function buildSynthesisPrompt(task: TaskContext): string {
  return [
    "You are capforge, synthesizing a new CLI-tool skill for a Claude Code agent.",
    "The skill must be a POSIX shell wrapper plus SKILL.md instructions.",
    "",
    `TASK GOAL: ${task.goal}`,
    `AVAILABLE TOOLS: ${task.available_tools.join(", ") || "(none)"}`,
    `AVAILABLE SKILLS: ${task.available_skills.join(", ") || "(none)"}`,
    `EXAMPLE INPUTS: ${JSON.stringify(task.example_inputs)}`,
    `PASS ASSERTION (shell; exit 0 = pass; env INPUT, OUTPUT, EXIT available): ${task.expected_assert}`,
    "",
    "Produce ONLY a SKILL.md with:",
    "1. YAML frontmatter: `name` (kebab-case), `description` (one line: when to invoke), `tools` (array).",
    "2. A short body: when the agent should invoke this skill.",
    "3. A fenced ```bash block containing a POSIX shell script that reads the input as $1",
    "   and writes stdout such that the PASS ASSERTION exits 0 for EVERY example input.",
    "",
    "Output the SKILL.md and nothing else.",
  ].join("\n");
}

export function computePromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

/** Which provider's key is available in the environment. */
export function resolveProvider(
  cfg: CapforgeConfig,
  opts: SynthesizeOptions = {},
): { provider: "anthropic" | "openai" | null; model: string } {
  const forced =
    opts.provider ?? (cfg.provider !== "auto" ? cfg.provider : undefined);
  if (forced) {
    return {
      provider: forced,
      model: opts.model ?? cfg.model ?? DEFAULT_MODELS[forced],
    };
  }
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  if (hasAnthropic) {
    return {
      provider: "anthropic",
      model: opts.model ?? cfg.model ?? DEFAULT_MODELS.anthropic,
    };
  }
  if (hasOpenAI) {
    return {
      provider: "openai",
      model: opts.model ?? cfg.model ?? DEFAULT_MODELS.openai,
    };
  }
  return { provider: null, model: "capforge-mock" };
}

export function hasApiKey(cfg: CapforgeConfig): boolean {
  return resolveProvider(cfg).provider !== null;
}

export async function synthesize(
  task: TaskContext,
  cfg: CapforgeConfig,
  opts: SynthesizeOptions = {},
): Promise<SynthesizeResult> {
  const prompt = buildSynthesisPrompt(task);
  const prompt_hash = computePromptHash(prompt);
  const synthesized_at = new Date().toISOString();

  const { provider, model } = resolveProvider(cfg, opts);
  const useMock = opts.mock || provider === null;
  if (useMock) {
    return {
      spec: synthesizeMock(task),
      synthesis: { model: "capforge-mock", prompt_hash, synthesized_at },
    };
  }

  const spec = await synthesizeWithLLM(
    prompt,
    provider as "anthropic" | "openai",
    model,
  );
  return { spec, synthesis: { model, prompt_hash, synthesized_at } };
}

async function synthesizeWithLLM(
  prompt: string,
  provider: "anthropic" | "openai",
  model: string,
): Promise<SkillSpec> {
  const client =
    provider === "anthropic"
      ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await generateText({ model: client(model), prompt });
  return parseSkillOutput(result.text);
}

/** Parse LLM markdown output into a SkillSpec (frontmatter + body + script). */
export function parseSkillOutput(md: string): SkillSpec {
  const { data, content } = matter(md);
  const name = String(data?.name ?? "skill");
  const description = String(data?.description ?? "synthesized by capforge");
  const tools = Array.isArray(data?.tools) ? data.tools.map(String) : ["Bash"];
  const body = content.replace(/^\n+/, "");
  const script = extractBashFence(body) ?? "";
  return { frontmatter: { name, description, tools }, body, script };
}

function extractBashFence(body: string): string | null {
  const m = body.match(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/);
  return m ? m[1].replace(/\s+$/, "") : null;
}

export function deriveMockName(goal: string): string {
  return (
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "skill"
  );
}

/** Deterministic offline synthesizer: a slugify-style string transform. */
export function synthesizeMock(task: TaskContext): SkillSpec {
  const name = deriveMockName(task.goal);
  const script = [
    "#!/usr/bin/env sh",
    "# capforge mock synthesizer - deterministic stand-in for offline/demo runs.",
    "set -eu",
    'in="${1:-}"',
    '# lowercase (ASCII), collapse non-alnum runs to "-", trim edges',
    'printf "%s" "$in" | LC_ALL=C tr "A-Z" "a-z" | LC_ALL=C tr -cs "A-Za-z0-9" "-" | sed "s:^-::; s:-$::"',
    "",
  ].join("\n");

  const body = [
    "## When to invoke",
    "",
    `Invoke this skill when the agent must ${task.goal.toLowerCase()}.`,
    "",
    "## How it works",
    "",
    "The wrapper reads a single input string on `$1` and writes the transformed",
    "result to stdout. It is a deterministic, dependency-free POSIX shell script.",
    "",
    "## Implementation",
    "",
    "```bash",
    script.trim(),
    "```",
    "",
  ].join("\n");

  return {
    frontmatter: { name, description: task.goal, tools: ["Bash"] },
    body,
    script,
  };
}
