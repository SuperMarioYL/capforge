import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { FORGE_VERSION } from "../src/skill/schema.js";
import { createApp } from "../src/server.js";

// v0.6.0 fix-version-drift-site-content-version: the version is duplicated
// across 6 surfaces with no single owner, and web/site.json had no
// content_version at all (the live site could not reflect the shipped tag).
// This locks the lockstep contract: every surface must agree with package.json,
// so a future bump that touches only one re-opens the drift under CI. The
// /api/health fallback path is exercised by unsetting npm_package_version
// (which `npm test` sets), so a stale hardcoded fallback is caught too.

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("version surfaces agree — no drift across VERSION/package.json/FORGE_VERSION/site.json/CHANGELOG/--version/health", async () => {
  const versionFile = (await readFile(join(ROOT, "VERSION"), "utf8")).trim();
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  const site = JSON.parse(await readFile(join(ROOT, "web", "site.json"), "utf8")) as {
    meta?: { content_version?: string };
  };
  const changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf8");

  assert.equal(versionFile, pkg.version, "VERSION file == package.json version");
  assert.equal(FORGE_VERSION, pkg.version, "FORGE_VERSION == package.json version");
  assert.equal(
    site.meta?.content_version,
    "v" + pkg.version,
    "web/site.json meta.content_version == v<package version>",
  );
  assert.ok(
    new RegExp(`^## \\[${pkg.version}\\]`, "m").test(changelog),
    "CHANGELOG has a top entry for the current version",
  );

  // CLI --version surface (spawned — the real user path; src/index.ts VERSION).
  const { stdout } = await execa(
    "node",
    ["--import", "tsx", "src/index.ts", "--version"],
    { cwd: ROOT, timeout: 30_000 },
  );
  assert.equal(stdout.trim(), pkg.version, "capforge --version == package version");

  // /api/health fallback surface — exercise the hardcoded fallback by unsetting
  // npm_package_version (set by `npm test`), so a stale src/server.ts fallback
  // constant is caught rather than masked by the env-derived value.
  const saved = process.env.npm_package_version;
  delete process.env.npm_package_version;
  try {
    const res = await createApp({ home: ROOT }).request("/api/health");
    const j = (await res.json()) as { version?: string };
    assert.equal(
      j.version,
      pkg.version,
      "/api/health fallback version == package version",
    );
  } finally {
    if (saved !== undefined) process.env.npm_package_version = saved;
  }
});
