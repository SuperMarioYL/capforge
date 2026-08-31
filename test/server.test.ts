import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createApp, openerUrl } from "../src/server.js";
import { forge } from "../src/forge/provenance.js";
import { loadOrCreateKeypair } from "../src/forge/sign.js";
import { keysDir, skillDir } from "../src/observe/intake.js";
import { slugifyTask, mkHome, mkClaudeTarget, cleanup } from "./util.js";

function app(home: string) {
  return createApp({ home });
}

async function req(home: string, method: string, path: string, body?: unknown) {
  const res = await app(home).request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}

test("GET /api/health reports the home dir", async () => {
  const home = await mkHome();
  try {
    const res = await req(home, "GET", "/api/health");
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.home, home);
  } finally {
    await cleanup(home);
  }
});

test("POST /api/forge runs the mock loop and returns a signed record", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const res = await req(home, "POST", "/api/forge", { task: slugifyTask, mock: true });
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.signed, true);
    assert.equal(j.test.pass, true);
    assert.ok(j.record);
    assert.equal(j.record.synthesis.model, "capforge-mock");
  } finally {
    await cleanup(home);
  }
});

test("POST /api/forge rejects a malformed task with 400", async () => {
  const home = await mkHome();
  try {
    const res = await req(home, "POST", "/api/forge", { task: { goal: "no inputs" } });
    assert.equal(res.status, 400);
    const j: any = await res.json();
    assert.ok(j.error);
  } finally {
    await cleanup(home);
  }
});

test("GET /api/skills lists forged skills; promote writes to the target dir", async () => {
  const home = await mkHome();
  const target = await mkClaudeTarget();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const forged = await forge(slugifyTask, { provider: "auto", model: null }, { home, mock: true });

    const res = await req(home, "GET", "/api/skills");
    const j: any = await res.json();
    assert.equal(j.skills.length, 1);
    assert.equal(j.skills[0].id, forged.id);
    assert.equal(j.skills[0].signed, true);

    const pres = await req(home, "POST", `/api/skills/${forged.id}/promote`, { targetDir: target });
    const pj: any = await pres.json();
    assert.equal(pj.promoted, true);
  } finally {
    await cleanup(home);
    await cleanup(target);
  }
});

// v0.2.0 fix-ui-server-no-origin-guard: the forge UI server shell-executes
// caller-supplied task.expected_assert (POST /api/forge) and writes to a
// caller-supplied targetDir (POST /api/skills/:id/promote). Without an origin
// guard, DNS rebinding (which defeats CORS and looks same-origin) yields
// arbitrary shell execution. Two lightweight guards: Host allowlist (blocks
// DNS rebinding) + startup secret on state-changing POSTs.

test("origin guard: a non-loopback Host header is rejected with 403", async () => {
  const home = await mkHome();
  try {
    const res = await app(home).request("/api/health", {
      headers: { host: "evil.example.com" },
    });
    assert.equal(res.status, 403);
  } finally {
    await cleanup(home);
  }
});

test("origin guard: a loopback Host is allowed", async () => {
  const home = await mkHome();
  try {
    const res = await app(home).request("/api/health", {
      headers: { host: "127.0.0.1" },
    });
    assert.equal(res.status, 200);
  } finally {
    await cleanup(home);
  }
});

test("secret gate: POST /api/forge without the secret is rejected 403 when a secret is set", async () => {
  const home = await mkHome();
  try {
    const a = createApp({ home, secret: "s3cret" });
    const res = await a.request("/api/forge", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: JSON.stringify({ task: slugifyTask, mock: true }),
    });
    assert.equal(res.status, 403);
  } finally {
    await cleanup(home);
  }
});

test("secret gate: POST /api/forge with the correct secret runs the forge loop", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const a = createApp({ home, secret: "s3cret" });
    const res = await a.request("/api/forge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1",
        "x-capforge-secret": "s3cret",
      },
      body: JSON.stringify({ task: slugifyTask, mock: true }),
    });
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.signed, true);
  } finally {
    await cleanup(home);
  }
});

// v0.3.0 fix-ui-secret-not-threaded: the browser flow opens the UI with
// ?capforge_token=<secret> (cmdUi) and the frontend sends NO x-capforge-secret
// header, so the server MUST accept the token via the query string on
// state-changing POSTs. Lock the browser path so forge/promote are not 403-ed.
test("secret gate: POST /api/forge accepts the token via ?capforge_token= query (browser path)", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const a = createApp({ home, secret: "s3cret" });
    const res = await a.request("/api/forge?capforge_token=s3cret", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: JSON.stringify({ task: slugifyTask, mock: true }),
    });
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.signed, true);
  } finally {
    await cleanup(home);
  }
});

test("secret gate: POST /api/forge rejects a wrong ?capforge_token= query (browser path)", async () => {
  const home = await mkHome();
  try {
    const a = createApp({ home, secret: "s3cret" });
    const res = await a.request("/api/forge?capforge_token=wrong", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: JSON.stringify({ task: slugifyTask, mock: true }),
    });
    assert.equal(res.status, 403);
  } finally {
    await cleanup(home);
  }
});

// v0.3.0 fix-verify-corrupt-provenance-crash: the GET /api/skills/:id detail
// endpoint called splitProvenance unguarded (only listForgedSkills was guarded
// in v0.2.0), so one corrupt SKILL.md 500-ed the detail API. It now returns a
// 422 corrupt marker instead.
test("detail endpoint: GET /api/skills/:id returns 422 corrupt marker on a corrupt SKILL.md", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const corruptId = "corrupt-detail-deadbeef";
    const corruptDir = skillDir(corruptId, home);
    await mkdir(corruptDir, { recursive: true });
    await writeFile(
      join(corruptDir, "SKILL.md"),
      "---\nname: broken\ndescription: d\ntools: []\n---\n\n## impl\n\nbroken\n\n" +
        "<!-- capforge:provenance -->\n{not valid json}\n<!-- /capforge:provenance -->\n",
      "utf8",
    );
    const res = await app(home).request(`/api/skills/${corruptId}`, {
      headers: { host: "127.0.0.1" },
    });
    assert.equal(res.status, 422);
    const j: any = await res.json();
    assert.equal(j.corrupt, true);
    assert.equal(j.signed, false);
  } finally {
    await cleanup(home);
  }
});

// v0.5.0 fix-verify-missing-skillmd-crash: the GET /api/skills/:id detail
// endpoint called readForgedSkillText unguarded (the v0.3.0 guard wrapped
// splitProvenance but not the upstream readFile), so a skill dir with no
// SKILL.md (forge killed mid-write after mkdir, or external deletion) 500-ed.
// It now returns a 404 missing-marker instead of crashing.
test("detail endpoint: GET /api/skills/:id returns 404 missing-marker on a skill dir with no SKILL.md", async () => {
  const home = await mkHome();
  try {
    const missingId = "missing-detail-deadbeef";
    await mkdir(skillDir(missingId, home), { recursive: true });
    const res = await app(home).request(`/api/skills/${missingId}`, {
      headers: { host: "127.0.0.1" },
    });
    assert.equal(res.status, 404);
    const j: any = await res.json();
    assert.equal(j.missing, true);
    assert.equal(j.signed, false);
    assert.equal(j.sig_valid, false);
  } finally {
    await cleanup(home);
  }
});

// v0.4.0 fix-skill-id-path-traversal-read: the `:id` path param flowed
// unvalidated into skillDir=join(home,"skills",id); Hono decodes %2F, so a
// `../`-encoded id escaped the capforge store and GET /api/skills/:id
// returned a foreign SKILL.md with 200 (the same id also drove the
// secret-gated promote write path). The id is now shape-checked at the server
// boundary before lookup.
test("path traversal: a valid-shape forged id still returns 200 on GET /api/skills/:id", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const forged = await forge(slugifyTask, { provider: "auto", model: null }, { home, mock: true });
    const res = await app(home).request(`/api/skills/${forged.id}`, {
      headers: { host: "127.0.0.1" },
    });
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.id, forged.id);
    assert.equal(j.signed, true);
    assert.ok(j.skillMd);
  } finally {
    await cleanup(home);
  }
});

test("path traversal: GET /api/skills/:id with a ../-encoded id is rejected and reads no foreign file", async () => {
  const home = await mkHome();
  const foreign = await mkHome();
  try {
    // Plant a SKILL.md OUTSIDE the capforge store (in a sibling temp home).
    const secretBody = "SECRET-OUT-OF-STORE-" + Math.random().toString(36).slice(2);
    await mkdir(join(foreign, "skills", "victim"), { recursive: true });
    await writeFile(join(foreign, "skills", "victim", "SKILL.md"), secretBody, "utf8");

    // id that, joined with <home>/skills, resolves to <foreign>/skills/victim.
    // %2F keeps it one path segment for Hono's :id matcher; param() then
    // decodes it to "../../<foreign>/skills/victim" — the traversal payload.
    const rel = relative(join(home, "skills"), join(foreign, "skills", "victim"));
    const traversal = encodeURIComponent(rel);
    const res = await app(home).request(`/api/skills/${traversal}`, {
      headers: { host: "127.0.0.1" },
    });
    assert.notEqual(res.status, 200, "traversal id must not 200 (old code returned the foreign file)");
    assert.equal(res.status, 400);
    const body = await res.text();
    assert.ok(!body.includes(secretBody), "foreign file body must not leak into the response");
  } finally {
    await cleanup(home);
    await cleanup(foreign);
  }
});

test("path traversal: POST /api/skills/:id/promote with a traversal id is rejected before any write", async () => {
  const home = await mkHome();
  const foreign = await mkHome();
  const target = await mkClaudeTarget();
  try {
    // Plant a foreign (unsigned) SKILL.md so that on the OLD code the promote
    // path would reach it via verifySkill and return 200 promoted:false (the
    // read-traversal precondition for the write path); the guard must reject
    // before any lookup/write.
    const secretBody = "SECRET-OUT-OF-STORE-" + Math.random().toString(36).slice(2);
    await mkdir(join(foreign, "skills", "victim"), { recursive: true });
    await writeFile(join(foreign, "skills", "victim", "SKILL.md"), secretBody, "utf8");

    const rel = relative(join(home, "skills"), join(foreign, "skills", "victim"));
    const traversal = encodeURIComponent(rel);
    const a = createApp({ home, secret: "s3cret" });
    const res = await a.request(`/api/skills/${traversal}/promote?capforge_token=s3cret`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: JSON.stringify({ targetDir: target }),
    });
    assert.notEqual(res.status, 200, "traversal id must not 200 (old code returned promoted:false)");
    assert.equal(res.status, 400);
    const written = await stat(join(target, "victim", "SKILL.md"))
      .then(() => true)
      .catch(() => false);
    assert.equal(written, false, "no file must be written under the target for a traversal id");
  } finally {
    await cleanup(home);
    await cleanup(foreign);
    await cleanup(target);
  }
});

// v0.4.0 fix-ui-secret-leaked-in-opener-argv: cmdUi passed the 128-bit startup
// secret in the open/xdg-open argv (?capforge_token=<secret>), world-readable
// via ps on shared hosts. The opener now receives a tokenless URL and the
// browser gets the secret via an HttpOnly cookie on GET /.
test("opener argv: the opener URL is tokenless (no capforge_token)", () => {
  const url = openerUrl("127.0.0.1", 7777);
  assert.equal(url, "http://127.0.0.1:7777/");
  assert.ok(!url.includes("capforge_token"), "opener URL must not carry the secret in argv");
});

test("ui cookie: GET / sets an HttpOnly+SameSite=Strict capforge_token cookie when a secret is set", async () => {
  const home = await mkHome();
  try {
    const a = createApp({ home, secret: "s3cret" });
    const res = await a.request("/", { headers: { host: "127.0.0.1" } });
    assert.equal(res.status, 200);
    const sc = res.headers.get("set-cookie");
    assert.ok(sc, "Set-Cookie present");
    assert.ok(sc!.includes("capforge_token=s3cret"), "cookie carries the secret");
    assert.ok(/httponly/i.test(sc!), "cookie is HttpOnly");
    assert.ok(/samesite=strict/i.test(sc!), "cookie is SameSite=Strict");
  } finally {
    await cleanup(home);
  }
});

test("ui cookie: GET / sets no cookie when no secret is configured", async () => {
  const home = await mkHome();
  try {
    const a = createApp({ home });
    const res = await a.request("/", { headers: { host: "127.0.0.1" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("set-cookie"), null);
  } finally {
    await cleanup(home);
  }
});

test("ui cookie: requireSecret accepts the capforge_token cookie (no header/query)", async () => {
  const home = await mkHome();
  try {
    await loadOrCreateKeypair(keysDir(home));
    const a = createApp({ home, secret: "s3cret" });
    const res = await a.request("/api/forge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1",
        cookie: "capforge_token=s3cret",
      },
      body: JSON.stringify({ task: slugifyTask, mock: true }),
    });
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.signed, true);
  } finally {
    await cleanup(home);
  }
});

test("ui cookie: requireSecret rejects a wrong capforge_token cookie with 403", async () => {
  const home = await mkHome();
  try {
    const a = createApp({ home, secret: "s3cret" });
    const res = await a.request("/api/forge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1",
        cookie: "capforge_token=wrong",
      },
      body: JSON.stringify({ task: slugifyTask, mock: true }),
    });
    assert.equal(res.status, 403);
  } finally {
    await cleanup(home);
  }
});
