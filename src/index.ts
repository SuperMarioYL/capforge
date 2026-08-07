#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import {
  capforgeHome,
  claudeSkillsDir,
  configPath,
  intakeTask,
  keysDir,
  loadConfig,
  saveConfig,
  skillsDir,
} from "./observe/intake.js";
import { loadOrCreateKeypair } from "./forge/sign.js";
import {
  forge,
  listForgedSkills,
  verifySkill,
  type ForgeResult,
} from "./forge/provenance.js";
import { reviewAndPromote } from "./promote/review.js";
import { startServer } from "./server.js";

/**
 * capforge CLI.
 *
 *   init | forge | verify | list | promote | ui
 *
 * Hand-rolled argument parsing — no CLI framework dep. The only verbs v0.1
 * needs are a handful of fixed-shape commands, so a switch + tiny flag loop
 * is smaller and more transparent than pulling in a parser.
 */

const VERSION = "0.3.0";

function usage(): string {
  return [
    `capforge ${VERSION} — just-in-time capability forge for agentic coding agents`,
    "",
    "usage:",
    "  capforge init                              create ~/.capforge (keypair, store, config)",
    "  capforge forge --task <path|json|->        observe → synthesize → test → sign → provenance",
    "         [--mock] [--provider anthropic|openai] [--model <id>]",
    "  capforge verify <id>                       report test-pass + signature-valid",
    "  capforge list                              list forged skills in the store",
    "  capforge promote <id>                      promote a signed skill to ~/.claude/skills/",
    "  capforge ui [--port 7777]                  open the local skill-forge UI",
    "  capforge --version | --help",
    "",
    "env:",
    "  ANTHROPIC_API_KEY / OPENAI_API_KEY   BYO model keys (read at forge time)",
    "  CAPFORGE_HOME                        override ~/.capforge (default)",
    "  CLAUDE_SKILLS_DIR                    override ~/.claude/skills (promote target)",
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(usage());
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return 0;
  }

  switch (cmd) {
    case "init":
      return cmdInit();
    case "forge":
      return cmdForge(args.slice(1));
    case "verify":
      return cmdVerify(args.slice(1));
    case "list":
      return cmdList();
    case "promote":
      return cmdPromote(args.slice(1));
    case "ui":
      return cmdUi(args.slice(1));
    default:
      console.error("unknown command: " + cmd + "\n");
      console.error(usage());
      return 2;
  }
}

async function cmdInit(): Promise<number> {
  const home = capforgeHome();
  await mkdir(keysDir(home), { recursive: true });
  await mkdir(skillsDir(home), { recursive: true });
  const kp = await loadOrCreateKeypair(keysDir(home));
  await saveConfig({ provider: "auto", model: null }, home);
  console.log("capforge initialized at " + home);
  console.log("  ed25519 pubkey: " + kp.pubkey.slice(0, 16) + "…");
  console.log("  skills store:   " + skillsDir(home));
  console.log("  config:         " + configPath(home));
  console.log(
    "  provider: auto — set ANTHROPIC_API_KEY or OPENAI_API_KEY to forge with an LLM",
  );
  return 0;
}

interface ForgeArgs {
  task?: string;
  mock?: boolean;
  provider?: "anthropic" | "openai";
  model?: string;
}

function parseForgeArgs(args: string[]): ForgeArgs {
  const o: ForgeArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--task" || a === "-t") o.task = args[++i];
    else if (a === "--mock") o.mock = true;
    else if (a === "--provider") {
      const p = args[++i];
      if (p === "anthropic" || p === "openai") o.provider = p;
    } else if (a === "--model") o.model = args[++i];
    else if (!a.startsWith("-") && !o.task) o.task = a;
  }
  return o;
}

async function cmdForge(args: string[]): Promise<number> {
  const o = parseForgeArgs(args);
  if (!o.task) {
    console.error("forge: --task <path|json|-> is required");
    return 2;
  }
  const home = capforgeHome();
  const task = await intakeTask(o.task);
  const cfg = await loadConfig(home);
  const r: ForgeResult = await forge(task, cfg, {
    home,
    mock: o.mock,
    provider: o.provider,
    model: o.model,
  });

  console.log("forged skill: " + r.id);
  console.log("  dir:        " + r.dir);
  console.log(
    "  model:      " + (r.record?.synthesis.model ?? "capforge-mock"),
  );
  console.log(
    "  test:       " +
      (r.test.pass ? "PASS" : "FAIL") +
      "  (" +
      r.test.traces.length +
      " example" +
      (r.test.traces.length === 1 ? "" : "s") +
      ")",
  );
  for (const t of r.test.traces.filter((x) => !x.assert_pass)) {
    console.log(
      "    ✗ input=" + JSON.stringify(t.input) + " exit=" + t.exit_code,
    );
  }
  if (r.signed && r.record) {
    console.log(
      "  signed:     ed25519 " + r.record.signature.pubkey.slice(0, 16) + "…",
    );
    console.log("  sig:        " + r.record.signature.sig.slice(0, 24) + "…");
    console.log("  provenance: embedded in SKILL.md");
    console.log("");
    console.log("  verify:     capforge verify " + r.id);
    return 0;
  }
  console.log("  signed:     NO — test failed, refusing to sign");
  console.log("  inspect:    " + r.dir);
  return 1;
}

async function cmdVerify(args: string[]): Promise<number> {
  const id = args[0];
  if (!id) {
    console.error("verify: <id> required");
    return 2;
  }
  const v = await verifySkill(id, capforgeHome());
  console.log("skill:       " + v.id);
  console.log("  signed:        " + (v.signed ? "yes" : "no"));
  console.log("  test:          " + (v.test_pass ? "PASS" : "FAIL"));
  console.log("  signature:     " + (v.sig_valid ? "VALID" : "INVALID"));
  if (v.pubkey) console.log("  pubkey:        " + v.pubkey.slice(0, 24) + "…");
  return v.signed && v.sig_valid && v.test_pass ? 0 : 1;
}

async function cmdList(): Promise<number> {
  const list = await listForgedSkills(capforgeHome());
  if (!list.length) {
    console.log("(no forged skills yet — run `capforge forge --task task.json`)");
    return 0;
  }
  for (const s of list) {
    const sig = s.signed ? (s.sig_valid ? "✓sig" : "✗sig") : "unsigned";
    const t = s.test_pass ? "✓test" : "✗test";
    console.log(s.id + "  [" + t + " " + sig + "]  " + s.name + "  (" + s.model + ")");
  }
  return 0;
}

async function cmdPromote(args: string[]): Promise<number> {
  const id = args[0];
  if (!id) {
    console.error("promote: <id> required");
    return 2;
  }
  const force = args.includes("--force");
  const r = await reviewAndPromote(id, { force });
  if (r.promoted) {
    console.log("promoted " + r.id + " → " + r.target);
    console.log("  Claude Code will load it on its next session.");
    return 0;
  }
  console.error("promote refused: " + (r.reason ?? "unknown"));
  return 1;
}

async function cmdUi(args: string[]): Promise<number> {
  let port = 7777;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
      port = parseInt(args[++i], 10);
    }
  }
  // v0.3.0 (fix-ui-secret-not-threaded): startServer always generates a
  // startup secret required on every state-changing POST. Open the
  // token-bearing URL (?capforge_token=<secret>) so the browser has the
  // token, which forge.html reads and sends as x-capforge-secret on
  // forge/verify/promote POSTs. Previously cmdUi opened a tokenless URL and
  // the frontend sent no secret header, so every browser POST 403-ed.
  const { port: actual, secret } = await startServer({ port });
  const url = `http://127.0.0.1:${actual}/?capforge_token=${secret}`;
  console.log("capforge forge UI: " + url);
  console.log("  promote target: " + claudeSkillsDir());
  console.log("  (Ctrl-C to stop)");
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  exec(opener + " " + url, () => {
    /* best-effort; ignore errors */
  });
  // run until killed
  return new Promise<number>(() => {});
}

main(process.argv)
  .then((code) => {
    process.exit(code);
  })
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("capforge: error:", msg);
    process.exit(1);
  });
