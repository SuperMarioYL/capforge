import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TaskContextSchema } from "./skill/schema.js";
import { capforgeHome, loadConfig } from "./observe/intake.js";
import {
  forge,
  listForgedSkills,
  readForgedSkillText,
  splitProvenance,
  verifySkill,
  type ForgeResult,
} from "./forge/provenance.js";
import { reviewAndPromote } from "./promote/review.js";

/**
 * forge-ui — a local hono server + single-page frontend. The demoable,
 * star-worthy surface: visualize the forge loop, review, and promote. No
 * network except the user's own LLM API; no auth, no multi-user (v0.1).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

let htmlCache: string | null = null;
async function readForgeHtml(): Promise<string> {
  if (htmlCache) return htmlCache;
  const candidates = [
    join(__dirname, "ui", "forge.html"), // dev: src/ui/forge.html (run from src/)
    join(__dirname, "..", "src", "ui", "forge.html"), // prod: dist/ -> ../src/ui/forge.html
  ];
  for (const p of candidates) {
    try {
      htmlCache = await readFile(p, "utf8");
      return htmlCache;
    } catch {
      /* try next */
    }
  }
  htmlCache =
    "<!doctype html><meta charset=utf-8><title>capforge forge</title>" +
    "<p>forge.html not found next to the running server.</p>";
  return htmlCache;
}

export interface ServerOptions {
  home?: string;
  port?: number;
  host?: string;
}

export function createApp(opts: ServerOptions = {}) {
  const home = opts.home ?? capforgeHome();
  const app = new Hono();

  app.get("/", async (c) => c.html(await readForgeHtml()));

  app.get("/api/health", (c) =>
    c.json({ ok: true, home, version: process.env.npm_package_version ?? "0.1.0" }),
  );

  app.get("/api/skills", async (c) => {
    const skills = await listForgedSkills(home);
    return c.json({ skills });
  });

  app.get("/api/skills/:id", async (c) => {
    const id = c.req.param("id");
    const text = await readForgedSkillText(id, home);
    const { skillMd, record } = splitProvenance(text);
    const v = await verifySkill(id, home);
    return c.json({
      id,
      skillMd,
      record,
      signed: v.signed,
      sig_valid: v.sig_valid,
      test_pass: v.test_pass,
    });
  });

  app.post("/api/skills/:id/verify", async (c) => {
    const id = c.req.param("id");
    const v = await verifySkill(id, home);
    return c.json(v);
  });

  app.post("/api/forge", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "expected a JSON body: { task, mock?, provider?, model? }" }, 400);
    }
    const parsed = TaskContextSchema.safeParse(body.task ?? body);
    if (!parsed.success) {
      return c.json({ error: "invalid task context", issues: parsed.error.issues }, 400);
    }
    const cfg = await loadConfig(home);
    const result: ForgeResult = await forge(parsed.data, cfg, {
      home,
      mock: body.mock === true ? true : undefined,
      provider: typeof body.provider === "string" ? body.provider : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    return c.json(result);
  });

  app.post("/api/skills/:id/promote", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const targetDir = typeof body.targetDir === "string" ? body.targetDir : undefined;
    const force = body.force === true ? true : undefined;
    const result = await reviewAndPromote(id, { home, targetDir, force });
    return c.json(result);
  });

  return app;
}

export async function startServer(opts: ServerOptions = {}): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const port = opts.port ?? 7777;
  const host = opts.host ?? "127.0.0.1";
  const server = serve({ fetch: createApp(opts).fetch, port, hostname: host });
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
