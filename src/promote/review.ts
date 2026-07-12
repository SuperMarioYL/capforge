import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  capforgeHome,
  claudeSkillsDir,
  skillDir,
} from "../observe/intake.js";
import { verifySkill } from "../forge/provenance.js";

/**
 * promote — the human-reviewed path from the local forge store to the
 * agent's permanent skill surface (~/.claude/skills/). v0.1 never
 * auto-promotes: a human clicks the Promote button, and capforge re-verifies
 * (signed + signature-valid + test-passed) before copying.
 *
 * Cross-organization provenance / trust graphs are out of scope — promote is
 * a local filesystem copy, gated on the local ed25519 signature.
 */

export interface PromoteOptions {
  home?: string;
  /** Override the destination skill directory (tests / CI). */
  targetDir?: string;
  /** Promote even if the test failed (still requires a valid signature). */
  force?: boolean;
}

export interface PromoteResult {
  id: string;
  promoted: boolean;
  target: string;
  signed: boolean;
  sig_valid: boolean;
  test_pass: boolean;
  reason?: string;
}

export async function reviewAndPromote(
  id: string,
  opts: PromoteOptions = {},
): Promise<PromoteResult> {
  const home = opts.home ?? capforgeHome();
  const targetDir = opts.targetDir ?? claudeSkillsDir();
  const target = join(targetDir, id, "SKILL.md");

  const v = await verifySkill(id, home);
  const base: PromoteResult = {
    id,
    promoted: false,
    target,
    signed: v.signed,
    sig_valid: v.sig_valid,
    test_pass: v.test_pass,
  };

  if (!v.signed) {
    return { ...base, reason: "skill is unsigned (failed its own test at forge time)" };
  }
  if (!v.sig_valid) {
    return { ...base, reason: "signature invalid — skill body was tampered with after forging" };
  }
  if (!v.test_pass && !opts.force) {
    return { ...base, reason: "test failed — refusing to promote (override with --force)" };
  }

  const src = join(skillDir(id, home), "SKILL.md");
  const destDir = join(targetDir, id);
  await mkdir(destDir, { recursive: true });
  const text = await readFile(src, "utf8");
  await writeFile(join(destDir, "SKILL.md"), text, "utf8");

  return { ...base, promoted: true };
}
