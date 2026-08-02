import { readFile, writeFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  FORGE_VERSION,
  ForgeRecordSchema,
  deriveSkillId,
  type ForgeRecord,
  type SkillSpec,
  type TaskContext,
  type TestResult,
  type UnsignedForgeRecord,
} from "../skill/schema.js";
import { serializeSkill, parseSkillMarkdown } from "../skill/format.js";
import {
  capforgeHome,
  keysDir,
  skillDir,
  skillsDir,
  observeOrigin,
  type CapforgeConfig,
} from "../observe/intake.js";
import { signSkill, verifyMessage } from "./sign.js";
import { runSkillTest } from "./test.js";
import { synthesize, type SynthesizeOptions } from "./synthesize.js";

/**
 * provenance — assemble the ForgeRecord and embed it as a tamper-evident
 * `<!-- capforge:provenance -->` block inside the SKILL.md, so a signed skill
 * stays self-contained and portable (the agent loads one file).
 *
 * v0.2.0: the signature commits to the canonical bytes of (skillMd + the full
 * record minus its `signature` sub-object), so editing the skill text OR any
 * provenance metadata (test / synthesis / origin / provenance) invalidates the
 * signature. See `canonicalSignedBytes` / `verifyRecordSignature`.
 */

const PROV_OPEN = "<!-- capforge:provenance -->";
const PROV_CLOSE = "<!-- /capforge:provenance -->";
const PROV_RE =
  /<!--\s*capforge:provenance\s*-->[\s\S]*?<!--\s*\/\s*capforge:provenance\s*-->/;
const TEST_SIDECAR = "test-result.json";

export interface ForgeOptions extends SynthesizeOptions {
  home?: string;
  timeoutMs?: number;
  parentSkillId?: string;
}

export interface ForgeResult {
  id: string;
  /** Full SKILL.md text (with embedded provenance iff signed). */
  skillMd: string;
  /** Full ForgeRecord iff signed; null when the test gate refused to sign. */
  record: ForgeRecord | null;
  dir: string;
  signed: boolean;
  test: TestResult;
}

export interface VerifyResult {
  id: string;
  signed: boolean;
  test_pass: boolean;
  sig_valid: boolean;
  record: ForgeRecord | null;
  pubkey: string | null;
}

export interface ForgedSkillSummary {
  id: string;
  name: string;
  description: string;
  signed: boolean;
  test_pass: boolean;
  sig_valid: boolean;
  model: string;
  created_at: string;
}

/** Append the ForgeRecord as a trailing HTML-comment block. */
export function embedProvenance(skillMd: string, record: ForgeRecord): string {
  return `${skillMd}\n\n${PROV_OPEN}\n${JSON.stringify(record, null, 2)}\n${PROV_CLOSE}\n`;
}

/** Split a SKILL.md into (skill text, provenance record | null). */
export function splitProvenance(text: string): {
  skillMd: string;
  record: ForgeRecord | null;
} {
  const m = text.match(PROV_RE);
  if (!m) return { skillMd: text.replace(/\s+$/, ""), record: null };
  const span = m[0];
  const inner = span
    .replace(/^<!--\s*capforge:provenance\s*-->/, "")
    .replace(/<!--\s*\/\s*capforge:provenance\s*-->$/, "")
    .trim();
  const record = ForgeRecordSchema.parse(JSON.parse(inner)) as ForgeRecord;
  const skillMd = text.replace(span, "").replace(/\s+$/, "");
  return { skillMd, record };
}

/** Canonical signed bytes: the SKILL.md text with trailing whitespace removed. */
export function canonicalSkillMd(spec: SkillSpec): string {
  return serializeSkill(spec).replace(/\s+$/, "");
}

/**
 * Stable (sorted-key, whitespace-free) JSON serialization so the signed bytes
 * are byte-deterministic regardless of key insertion order. Undefined-valued
 * keys are omitted (matching JSON.stringify semantics and Zod's handling of
 * undefined optionals), so signing over a raw record and verifying over the
 * Zod-parsed record produce identical bytes.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * v0.2.0 (fix-signature-skips-provenance-record): the signed bytes now commit
 * to BOTH the canonical skill text AND the full ForgeRecord minus its
 * `signature` sub-object (skill / origin / synthesis / test / provenance), as
 * a stable-JSON envelope. Previously only `skillMd` was signed, so the
 * provenance metadata (test.pass, synthesis.model, origin) parsed from the
 * unsigned embedded block was not tamper-evident — a shared skill could edit
 * those fields and keep a valid signature.
 */
export function canonicalSignedBytes(
  skillMd: string,
  record: UnsignedForgeRecord,
): string {
  const { skill, origin, synthesis, test, provenance } = record;
  return stableStringify({ skill_md: skillMd, skill, origin, synthesis, test, provenance });
}

/**
 * Re-derive the canonical signed bytes from a parsed record (minus its
 * signature sub-object) + the extracted skill text, and verify the signature
 * over them. Shared by `verifySkill` and `listForgedSkills` so both the
 * single-skill verify path and the list path enforce the same integrity check.
 */
function verifyRecordSignature(skillMd: string, record: ForgeRecord): boolean {
  const { signature: _sig, ...rest } = record;
  return verifyMessage(
    canonicalSignedBytes(skillMd, rest),
    record.signature.sig,
    record.signature.pubkey,
  );
}

/**
 * The full observe → synthesize → test → sign → provenance loop.
 *
 * Test gate: a skill that fails its own test is NEVER signed — it is
 * persisted unsigned for inspection, and `verify` reports signature-invalid.
 */
export async function forge(
  task: TaskContext,
  cfg: CapforgeConfig,
  opts: ForgeOptions = {},
): Promise<ForgeResult> {
  const home = opts.home ?? capforgeHome();
  const origin = observeOrigin(task);

  const { spec, synthesis } = await synthesize(task, cfg, opts);
  const test = await runSkillTest(spec, task, { timeoutMs: opts.timeoutMs });

  const skillMd = canonicalSkillMd(spec);
  const id = deriveSkillId(spec);
  const dir = skillDir(id, home);

  if (!test.pass) {
    await persistUnsigned(home, id, skillMd, test);
    return { id, skillMd, record: null, dir, signed: false, test };
  }

  // v0.2.0: sign the canonical bytes of (skillMd + full record minus
  // signature), so the embedded provenance metadata is tamper-evident, not
  // just the skill text.
  const unsigned: UnsignedForgeRecord = {
    skill: spec,
    origin,
    synthesis,
    test,
    provenance: {
      forge_version: FORGE_VERSION,
      parent_skill_id: opts.parentSkillId,
    },
  };
  const sig = await signSkill(canonicalSignedBytes(skillMd, unsigned), keysDir(home));
  const record: ForgeRecord = {
    ...unsigned,
    signature: {
      algo: "ed25519",
      pubkey: sig.pubkey,
      sig: sig.sig,
      signed_at: sig.signed_at,
    },
  };
  const fullMd = embedProvenance(skillMd, record);
  await persistSigned(home, id, fullMd, record);
  return { id, skillMd: fullMd, record, dir, signed: true, test };
}

async function persistSigned(
  home: string,
  id: string,
  skillMd: string,
  record: ForgeRecord,
): Promise<void> {
  const dir = skillDir(id, home);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd, "utf8");
  await writeFile(join(dir, "forge-record.json"), JSON.stringify(record, null, 2) + "\n", "utf8");
}

async function persistUnsigned(
  home: string,
  id: string,
  skillMd: string,
  test: TestResult,
): Promise<void> {
  const dir = skillDir(id, home);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd, "utf8");
  await writeFile(join(dir, TEST_SIDECAR), JSON.stringify(test, null, 2) + "\n", "utf8");
}

/** Read raw SKILL.md text for a forged skill id. */
export async function readForgedSkillText(
  id: string,
  home = capforgeHome(),
): Promise<string> {
  return readFile(join(skillDir(id, home), "SKILL.md"), "utf8");
}

export async function verifySkill(
  id: string,
  home = capforgeHome(),
): Promise<VerifyResult> {
  const text = await readForgedSkillText(id, home);
  const { skillMd, record } = splitProvenance(text);
  if (!record) {
    const tr = await readTestResult(id, home);
    return {
      id,
      signed: false,
      test_pass: tr?.pass ?? false,
      sig_valid: false,
      record: null,
      pubkey: null,
    };
  }
  const sig_valid = verifyRecordSignature(skillMd, record);
  return {
    id,
    signed: true,
    test_pass: record.test.pass,
    sig_valid,
    record,
    pubkey: record.signature.pubkey,
  };
}

async function readTestResult(
  id: string,
  home: string,
): Promise<TestResult | null> {
  try {
    const raw = await readFile(join(skillDir(id, home), TEST_SIDECAR), "utf8");
    return JSON.parse(raw) as TestResult;
  } catch {
    return null;
  }
}

/** Summaries for the forge UI. */
export async function listForgedSkills(
  home = capforgeHome(),
): Promise<ForgedSkillSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir(home));
  } catch {
    return [];
  }

  const out: ForgedSkillSummary[] = [];
  for (const id of entries) {
    const s = await stat(skillDir(id, home)).catch(() => null);
    if (!s?.isDirectory()) continue;
    const text = await readFile(join(skillDir(id, home), "SKILL.md"), "utf8").catch(
      () => null,
    );
    if (!text) continue;

    // v0.2.0 (fix-list-corrupt-provenance-blast-radius): guard
    // splitProvenance the same way parseSkillMarkdown is guarded below — a
    // single malformed provenance block (half-written SKILL.md from a process
    // killed mid-forge) must not break listing the rest. Push a
    // corrupt/unsigned summary entry so the broken skill is still visible.
    let skillMd = "";
    let record: ForgeRecord | null = null;
    try {
      const split = splitProvenance(text);
      skillMd = split.skillMd;
      record = split.record;
    } catch {
      out.push({
        id,
        name: id,
        description: "(corrupt provenance — unreadable)",
        signed: false,
        test_pass: false,
        sig_valid: false,
        model: "(corrupt)",
        created_at: "(corrupt)",
      });
      continue;
    }
    let frontmatter;
    try {
      frontmatter = parseSkillMarkdown(text).frontmatter;
    } catch {
      frontmatter = { name: id, description: "", tools: [] };
    }

    if (record) {
      const sig_valid = verifyRecordSignature(skillMd, record);
      out.push({
        id,
        name: record.skill.frontmatter.name,
        description: record.skill.frontmatter.description,
        signed: true,
        test_pass: record.test.pass,
        sig_valid,
        model: record.synthesis.model,
        created_at: record.signature.signed_at,
      });
    } else {
      const tr = await readTestResult(id, home);
      out.push({
        id,
        name: frontmatter.name,
        description: frontmatter.description,
        signed: false,
        test_pass: tr?.pass ?? false,
        sig_valid: false,
        model: "(unsigned)",
        created_at: "(unsigned)",
      });
    }
  }
  return out;
}

export async function deleteForgedSkill(
  id: string,
  home = capforgeHome(),
): Promise<void> {
  await rm(skillDir(id, home), { recursive: true, force: true });
}
