import { z } from "zod";
import { createHash } from "node:crypto";

/**
 * capforge owns the ForgeRecord — the unit of runtime skill synthesis.
 *
 * The owned layer is the observe → synthesize → test → sign → provenance
 * protocol, scoped to a named agent's skill surface (Claude Code SKILL.md).
 * This file is the single source of truth for the data shapes that flow
 * through that protocol.
 */

/** The forge protocol version, stamped into every ForgeRecord's provenance. */
export const FORGE_VERSION = "0.2.0";

/** The single agent harness capforge v0.1 targets. */
export const TARGET_HARNESS = "claude-code" as const;

/**
 * TaskContext — what the agent observes about the task it just failed at.
 * Supplied via `task.json` (v0.1 does not hook the agent runtime; that is
 * explicitly out of scope until v0.2).
 */
export const TaskContextSchema = z.object({
  goal: z.string().min(1),
  available_tools: z.array(z.string()).default([]),
  available_skills: z.array(z.string()).default([]),
  example_inputs: z.array(z.string()).min(1),
  /** Shell assertion; exit 0 on an example's output means the skill passed it. */
  expected_assert: z.string().min(1),
});
export type TaskContext = z.infer<typeof TaskContextSchema>;

/**
 * SkillFrontmatter — the SKILL.md YAML header. Matches the Claude Code
 * skill frontmatter contract (name / description / tools).
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tools: z.array(z.string()).default([]),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * SkillSpec — the candidate skill capforge synthesizes. A "CLI-tool skill"
 * (the only type v0.1 forges): a shell wrapper plus SKILL.md instructions.
 */
export const SkillSpecSchema = z.object({
  frontmatter: SkillFrontmatterSchema,
  body: z.string().min(1),
  /** The shell wrapper the skill wraps. Absent for pure-instruction skills. */
  script: z.string().optional(),
});
export type SkillSpec = z.infer<typeof SkillSpecSchema>;

/** One example's trace from the sandbox test run. */
export const TestTraceSchema = z.object({
  input: z.string(),
  exit_code: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  assert_pass: z.boolean(),
});
export type TestTrace = z.infer<typeof TestTraceSchema>;

/** Machine-checkable result of running the skill against example_inputs. */
export const TestResultSchema = z.object({
  pass: z.boolean(),
  traces: z.array(TestTraceSchema),
  duration_ms: z.number(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

/** Where the ForgeRecord came from. */
export const OriginSchema = z.object({
  task_context: TaskContextSchema,
  observed_at: z.string(),
  harness: z.literal(TARGET_HARNESS),
  agent_version: z.string(),
});
export type Origin = z.infer<typeof OriginSchema>;

/** How the skill body was produced. */
export const SynthesisSchema = z.object({
  model: z.string(),
  prompt_hash: z.string(),
  synthesized_at: z.string(),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

/** ed25519 signature over the canonical skill bytes (frontmatter + body). */
export const SignatureSchema = z.object({
  algo: z.literal("ed25519"),
  pubkey: z.string(),
  sig: z.string(),
  signed_at: z.string(),
});
export type Signature = z.infer<typeof SignatureSchema>;

/** Provenance metadata. */
export const ProvenanceMetaSchema = z.object({
  parent_skill_id: z.string().optional(),
  forge_version: z.string(),
});
export type ProvenanceMeta = z.infer<typeof ProvenanceMetaSchema>;

/**
 * ForgeRecord — the unit capforge owns. Not a load-time attestation of an
 * existing skill; the runtime synthesis + attestation of a brand-new skill
 * in one loop. Serialized as a `<!-- capforge:provenance -->` block inside
 * the SKILL.md so the signed skill stays portable.
 */
export const ForgeRecordSchema = z.object({
  skill: SkillSpecSchema,
  origin: OriginSchema,
  synthesis: SynthesisSchema,
  test: TestResultSchema,
  signature: SignatureSchema,
  provenance: ProvenanceMetaSchema,
});
export type ForgeRecord = z.infer<typeof ForgeRecordSchema>;

/** A ForgeRecord without its signature — the pre-signing assembly state. */
export type UnsignedForgeRecord = Omit<ForgeRecord, "signature">;

/**
 * Derive a stable, human-readable skill id from a SkillSpec.
 * `<slug(name)>-<sha8>` so names collide safely and the id is auditable.
 */
export function deriveSkillId(spec: SkillSpec): string {
  const slug = spec.frontmatter.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const hash = createHash("sha256")
    .update(JSON.stringify({ n: spec.frontmatter.name, b: spec.body, s: spec.script ?? "" }))
    .digest("hex")
    .slice(0, 8);
  return `${slug || "skill"}-${hash}`;
}

/** Canonical bytes a signature commits to: frontmatter + body + script. */
export function canonicalSkillBytes(spec: SkillSpec): string {
  const fm = {
    name: spec.frontmatter.name,
    description: spec.frontmatter.description,
    tools: spec.frontmatter.tools,
  };
  return JSON.stringify({ frontmatter: fm, body: spec.body, script: spec.script ?? "" });
}
