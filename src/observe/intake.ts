import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  TARGET_HARNESS,
  TaskContextSchema,
  type Origin,
  type TaskContext,
} from "../skill/schema.js";

/**
 * observe — read the task context and the local environment.
 *
 * v0.1 does NOT hook the agent runtime (auto-observe from inside Claude Code
 * is explicitly out of scope until v0.2). The task context arrives via
 * `task.json` (file, JSON string, or stdin). What capforge *does* observe is
 * the host environment: the harness name (Claude Code), the agent version,
 * and the moment the forge happened.
 */

export interface CapforgeConfig {
  /** "auto" picks the provider whose API key is set in the environment. */
  provider: "anthropic" | "openai" | "auto";
  /** Override the default model id; null = use the per-provider default. */
  model: string | null;
}

const DEFAULT_CONFIG: CapforgeConfig = { provider: "auto", model: null };

export function capforgeHome(): string {
  return process.env.CAPFORGE_HOME ?? join(homedir(), ".capforge");
}
export function keysDir(home = capforgeHome()): string {
  return join(home, "keys");
}
export function skillsDir(home = capforgeHome()): string {
  return join(home, "skills");
}
export function skillDir(id: string, home = capforgeHome()): string {
  return join(skillsDir(home), id);
}
export function configPath(home = capforgeHome()): string {
  return join(home, "config.json");
}
/** Where promoted skills land so Claude Code loads them. */
export function claudeSkillsDir(): string {
  return process.env.CLAUDE_SKILLS_DIR ?? join(homedir(), ".claude", "skills");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function agentVersion(): string {
  return process.env.CLAUDE_CODE_VERSION ?? "unknown";
}

export async function loadConfig(home = capforgeHome()): Promise<CapforgeConfig> {
  try {
    const raw = await readFile(configPath(home), "utf8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(
  cfg: CapforgeConfig,
  home = capforgeHome(),
): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(configPath(home), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/** Read a TaskContext from a file path, a JSON string, or "-" for stdin. */
export async function intakeTask(source: string): Promise<TaskContext> {
  let raw: string;
  const trimmed = source.trim();
  if (trimmed === "-") {
    raw = await readStdin();
  } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    raw = trimmed;
  } else {
    raw = await readFile(source, "utf8");
  }
  return TaskContextSchema.parse(JSON.parse(raw));
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** Build the ForgeRecord origin block from a task + the observed environment. */
export function observeOrigin(task: TaskContext): Origin {
  return {
    task_context: task,
    observed_at: nowIso(),
    harness: TARGET_HARNESS,
    agent_version: agentVersion(),
  };
}
