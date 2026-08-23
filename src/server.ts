import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { TaskContextSchema, type ForgeRecord } from "./skill/schema.js";
import { capforgeHome, loadConfig, validSkillId } from "./observe/intake.js";
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

// v0.2.0 (fix-ui-server-no-origin-guard): the forge UI server shell-executes
// caller-supplied task.expected_assert (POST /api/forge) and writes to a
// caller-supplied targetDir (POST /api/skills/:id/promote). Without an origin
// guard, DNS rebinding (which defeats CORS and looks same-origin to the
// browser) yields arbitrary shell execution as the user. Two lightweight
// guards (NOT multi-user auth, which v0.1 defers):
//   1. Host-header allowlist — reject any request whose Host is not a
//      loopback host (blocks DNS rebinding; the rebinded domain's Host is not
//      127.0.0.1).
//   2. Startup secret token — required on state-changing POSTs so a
//      same-origin hostile page that somehow passed the Host check still
//      cannot trigger shell exec. Printed at startup; pass via the
//      x-capforge-secret header or ?capforge_token= query param.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", ""]);

function hostAllowed(host: string | undefined): boolean {
  if (!host) return true; // no Host header = direct local request
  let h = host.toLowerCase();
  // strip the port from a bracketed ipv6 [::1]:port or a plain host:port
  h = h.replace(/^\[(.+)\]:\d+$/, "[$1]").replace(/^(.+):(\d+)$/, "$1");
  return LOOPBACK_HOSTS.has(h);
}

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
  /** Startup secret required on state-changing POSTs. When set, /api/forge,
   * /api/skills/:id/verify, and /api/skills/:id/promote require it via the
   * x-capforge-secret header or ?capforge_token= query param. `startServer`
   * generates one; tests/dev may omit it (no secret gate fires). */
  secret?: string;
}

export function createApp(opts: ServerOptions = {}) {
  const home = opts.home ?? capforgeHome();
  const secret = opts.secret;
  const app = new Hono();

  // Origin guard: reject any request whose Host header is not a loopback host.
  app.use("*", async (c, next) => {
    if (!hostAllowed(c.req.header("host"))) {
      return c.json({ error: "forbidden: non-loopback Host header" }, 403);
    }
    await next();
  });

  // Secret gate for state-changing endpoints. When a startup secret is set,
  // POSTs that shell-execute (forge) or write files (promote) — plus verify —
  // require the token so a same-origin hostile page cannot drive them. The
  // token is accepted via the x-capforge-secret header, the ?capforge_token=
  // query (CLI/curl), or the capforge_token cookie (browser — v0.4.0).
  const requireSecret: MiddlewareHandler = async (c, next) => {
    if (secret === undefined) {
      await next();
      return;
    }
    const token =
      c.req.header("x-capforge-secret") ??
      c.req.query("capforge_token") ??
      getCookie(c, "capforge_token") ??
      null;
    if (token !== secret) {
      return c.json({ error: "forbidden: missing or invalid capforge secret" }, 403);
    }
    await next();
  };

  // v0.4.0 (fix-ui-secret-leaked-in-opener-argv): deliver the startup secret
  // to the browser via an HttpOnly + SameSite=Strict cookie instead of putting
  // it in the opener argv (?capforge_token= was world-readable via ps on
  // shared hosts, re-opening the shell-exec/file-write surface the v0.2.0
  // origin-guard closed). The browser opens a tokenless
  // http://127.0.0.1:<port>/; this cookie is what requireSecret reads on the
  // browser's same-origin POSTs. HttpOnly blocks JS exfiltration; SameSite=
  // Strict keeps the v0.2.0 cross-origin CSRF defense (a hostile cross-site
  // page cannot ride the cookie onto a state-changing POST).
  app.get("/", async (c) => {
    if (secret !== undefined) {
      setCookie(c, "capforge_token", secret, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
      });
    }
    return c.html(await readForgeHtml());
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, home, version: process.env.npm_package_version ?? "0.4.0" }),
  );

  app.get("/api/skills", async (c) => {
    const skills = await listForgedSkills(home);
    return c.json({ skills });
  });

  app.get("/api/skills/:id", async (c) => {
    const id = c.req.param("id");
    // v0.4.0 (fix-skill-id-path-traversal-read): reject a non-skill id before
    // lookup. Hono decodes %2F, so an unvalidated `../`-encoded id escaped the
    // capforge store via skillDir=join(home,"skills",id) — a path-traversal
    // read of arbitrary SKILL.md here. The same guard closes the
    // secret-gated promote write path below.
    if (!validSkillId(id)) {
      return c.json({ error: "invalid skill id" }, 400);
    }
    const text = await readForgedSkillText(id, home);
    // v0.3.0 (fix-verify-corrupt-provenance-crash): guard splitProvenance so a
    // corrupt provenance block returns a 422 corrupt marker instead of 500-ing
    // — the listForgedSkills path was guarded in v0.2.0; this per-skill detail
    // endpoint was not. verifySkill (called below) is now guarded too.
    let skillMd = "";
    let record: ForgeRecord | null = null;
    let corrupt = false;
    try {
      const split = splitProvenance(text);
      skillMd = split.skillMd;
      record = split.record;
    } catch {
      corrupt = true;
    }
    const v = await verifySkill(id, home);
    if (corrupt) {
      return c.json(
        {
          id,
          corrupt: true,
          skillMd: "",
          record: null,
          signed: false,
          sig_valid: false,
          test_pass: v.test_pass,
        },
        422,
      );
    }
    return c.json({
      id,
      skillMd,
      record,
      signed: v.signed,
      sig_valid: v.sig_valid,
      test_pass: v.test_pass,
    });
  });

  app.post("/api/skills/:id/verify", requireSecret, async (c) => {
    const id = c.req.param("id");
    if (!validSkillId(id)) {
      return c.json({ error: "invalid skill id" }, 400);
    }
    const v = await verifySkill(id, home);
    return c.json(v);
  });

  app.post("/api/forge", requireSecret, async (c) => {
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

  app.post("/api/skills/:id/promote", requireSecret, async (c) => {
    const id = c.req.param("id");
    if (!validSkillId(id)) {
      return c.json({ error: "invalid skill id" }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const targetDir = typeof body.targetDir === "string" ? body.targetDir : undefined;
    const force = body.force === true ? true : undefined;
    const result = await reviewAndPromote(id, { home, targetDir, force });
    return c.json(result);
  });

  return app;
}

/**
 * v0.4.0 (fix-ui-secret-leaked-in-opener-argv): the URL handed to the opener
 * (open/xdg-open) MUST be tokenless — process argv is world-readable via `ps`
 * on shared hosts, so the 128-bit startup secret must never appear in it. The
 * token-bearing URL is only for the user's own terminal (printed by startServer
 * and cmdUi); the browser receives the secret via an HttpOnly cookie on GET /.
 */
export function openerUrl(host: string, port: number): string {
  return `http://${host}:${port}/`;
}

export async function startServer(opts: ServerOptions = {}): Promise<{
  port: number;
  secret: string;
  /** Tokenless URL for the opener argv (never contains the secret). */
  openerUrl: string;
  close: () => Promise<void>;
}> {
  const port = opts.port ?? 7777;
  const host = opts.host ?? "127.0.0.1";
  const secret = opts.secret ?? randomBytes(16).toString("hex");
  const server = serve({ fetch: createApp({ ...opts, secret }).fetch, port, hostname: host });
  const open = openerUrl(host, port);
  // Print the secret-bearing URL to the user's own terminal (stderr) for
  // non-browser use (curl, etc.); the browser gets the secret via the HttpOnly
  // capforge_token cookie set on GET / instead of this URL in the opener argv.
  console.error(`capforge ui: ${open}?capforge_token=${secret}`);
  console.error(
    `  (Host must be ${host}; browser uses the HttpOnly capforge_token cookie; CLI/curl uses ?capforge_token= or x-capforge-secret)`,
  );
  return {
    port,
    secret,
    openerUrl: open,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
