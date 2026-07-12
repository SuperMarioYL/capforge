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
 * The signature commits to the SKILL.md text *minus* the provenance block.
 * That is the bytes the agent actually loads — edit them and verify fails.
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

  const sig = await signSkill(skillMd, keysDir(home));
  const record: ForgeRecord = {
    skill: spec,
    origin,
    synthesis,
    test,
    signature: {
      algo: "ed25519",
      pubkey: sig.pubkey,
      sig: sig.sig,
      signed_at: sig.signed_at,
    },
    provenance: {
      forge_version: FORGE_VERSION,
      parent_skill_id: opts.parentSkillId,
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
  const sig_valid = verifyMessage(skillMd, record.signature.sig, record.signature.pubkey);
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

    const { skillMd, record } = splitProvenance(text);
    let frontmatter;
    try {
      frontmatter = parseSkillMarkdown(text).frontmatter;
    } catch {
      frontmatter = { name: id, description: "", tools: [] };
    }

    if (record) {
      const sig_valid = verifyMessage(
        skillMd,
        record.signature.sig,
        record.signature.pubkey,
      );
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
