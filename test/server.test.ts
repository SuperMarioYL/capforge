import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { forge } from "../src/forge/provenance.js";
import { loadOrCreateKeypair } from "../src/forge/sign.js";
import { keysDir } from "../src/observe/intake.js";
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
