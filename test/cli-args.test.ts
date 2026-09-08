import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

// v0.6.0 fix-provider-flag-silently-swallowed: parseForgeArgs (src/index.ts)
// used to drop an invalid --provider value silently, so `--provider gemini`
// forged via mock/anthropic with exit 0 and no diagnostic — the user's
// explicit choice was a silent no-op. It must now exit 2 with a diagnostic and
// must NOT forge. The companion case asserts a valid provider still reaches
// the next arg check (not over-rejected).

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROVIDER_ERR = /must be 'anthropic' or 'openai'/;

test("forge --provider <invalid> is rejected at the CLI boundary (exit 2, no skill forged)", async () => {
  const home = await mkdtemp(join(tmpdir(), "capforge-cli-args-neg-"));
  try {
    const r = await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/index.ts",
        "forge",
        "--task",
        "examples/task-slugify.json",
        "--provider",
        "gemini",
      ],
      {
        cwd: ROOT,
        env: { ...process.env, CAPFORGE_HOME: home },
        reject: false,
        timeout: 30_000,
      },
    );
    assert.equal(r.exitCode, 2, "invalid --provider must exit 2, got " + r.exitCode);
    assert.match(
      (r.stderr || "") + (r.stdout || ""),
      PROVIDER_ERR,
      "must print the provider-rejection diagnostic",
    );
    const skills = await readdir(join(home, "skills")).catch(() => []);
    assert.equal(
      skills.length,
      0,
      "no skill must be forged when the provider is invalid",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("forge --provider anthropic is accepted (reaches the --task check, not over-rejected)", async () => {
  const home = await mkdtemp(join(tmpdir(), "capforge-cli-args-pos-"));
  try {
    // A valid provider must NOT trip the provider guard. With no --task, the
    // next validation fires ("--task is required", exit 2) — proving the valid
    // provider value was accepted and parseForgeArgs returned normally.
    const r = await execa(
      "node",
      ["--import", "tsx", "src/index.ts", "forge", "--provider", "anthropic"],
      {
        cwd: ROOT,
        env: { ...process.env, CAPFORGE_HOME: home },
        reject: false,
        timeout: 30_000,
      },
    );
    assert.equal(r.exitCode, 2, "missing --task exits 2");
    const combined = (r.stderr || "") + (r.stdout || "");
    assert.doesNotMatch(combined, PROVIDER_ERR, "valid provider must not be rejected");
    assert.match(combined, /is required/, "reaches the --task-required check");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
