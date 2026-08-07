# Changelog

All notable changes to capforge are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-07

### Fixed
- **Forge UI browser flow no longer 403-ed against the startup secret** — v0.2.0's origin guard made `startServer` always generate a startup secret required on every state-changing POST (`/api/forge`, `/api/skills/:id/verify`, `/api/skills/:id/promote`), but `cmdUi` (`src/index.ts`) opened a tokenless URL and the frontend (`src/ui/forge.html`) sent no `x-capforge-secret` header and never read `?capforge_token=` — so from the browser every forge/verify/promote returned `403 forbidden: missing or invalid capforge secret` and the m3 "click Promote" demo was broken end-to-end. `cmdUi` now opens `http://127.0.0.1:<port>/?capforge_token=<secret>` and `forge.html` reads the token from `location.search` and sends it as `x-capforge-secret` on the forge + promote POSTs. (`src/index.ts`, `src/ui/forge.html`)
- **One corrupt provenance block no longer crashes `verify` / `promote` / the detail API** — v0.2.0's corrupt-provenance guard wrapped `splitProvenance` in try/catch only inside `listForgedSkills`, so a malformed `<!-- capforge:provenance -->` block (e.g. a half-written `SKILL.md` from a process killed mid-forge) still crashed `capforge verify`, `capforge promote`, the `GET /api/skills/:id` detail endpoint, and the promote API — the same blast radius the v0.2.0 fix meant to close. `splitProvenance` is now guarded in `verifySkill` (returns a non-throwing invalid result) and in the detail endpoint (returns a 422 corrupt marker); `reviewAndPromote` degrades gracefully because it calls `verifySkill`. (`src/forge/provenance.ts`, `src/server.ts`, `src/promote/review.ts`)

### Changed
- Bumped the forge protocol version (`FORGE_VERSION`) stamped into every `ForgeRecord.provenance` to `0.3.0`.
- Package version `0.2.0` → `0.3.0`.

## [0.2.0] - 2026-08-03

### Fixed
- **Timeout no longer reports exit 0 (m2 gate)** — with `execa` `reject:false` a timed-out skill run resolved with `exitCode===undefined` and `r.exitCode ?? 0` coerced it to exit 0, so a hung skill passed its assert, was marked `test.pass=true`, and got ed25519-signed. A timeout now maps to exit 124 and forces `assert_pass=false`, so a skill that hangs past the timeout is never signed. (`src/forge/test.ts`)
- **One corrupt provenance block no longer breaks `capforge list`** — `splitProvenance` was called outside any try/catch in `listForgedSkills` while the sibling `parseSkillMarkdown` call was guarded; a malformed `<!-- capforge:provenance -->` block (e.g. a half-written `SKILL.md` from a process killed mid-forge) threw and broke the whole `list` command and the `GET /api/skills` endpoint. `splitProvenance` is now guarded and a corrupt skill surfaces as a `signed=false` summary entry instead of crashing the listing. (`src/forge/provenance.ts`)
- **Signature now commits to the full ForgeRecord, not only the skill text** — the ed25519 signature previously committed only to `skillMd`, so `record.test` / `record.synthesis` / `record.origin` / `record.provenance` were parsed from unsigned embedded JSON and were not tamper-evident: editing `record.test.pass`, `record.synthesis.model`, or `record.origin` left `sig_valid===true`, breaking the integrity guarantee for exactly the metadata a shared skill carries. The signature now commits to canonical (stable-JSON) bytes of the skill text plus the full record minus its `signature` sub-object, so any metadata tamper invalidates the signature. (`src/forge/provenance.ts`)
- **Forge UI server gated on request origin** — the local forge UI server bound `127.0.0.1` with no Host/Origin/CSRF guard while `POST /api/forge` shell-executes caller-supplied `task.expected_assert` and `POST /api/skills/:id/promote` writes to a caller-supplied `targetDir`; DNS rebinding (which defeats CORS and looks same-origin to the browser) yielded arbitrary shell execution as the user. The server now rejects non-loopback `Host` headers and requires a startup secret token (printed at startup, passed via `x-capforge-secret` header or `?capforge_token=`) on state-changing POSTs. (`src/server.ts`)

### Changed
- Bumped the forge protocol version (`FORGE_VERSION`) stamped into every `ForgeRecord.provenance` to `0.2.0`.
- Package version `0.1.0` → `0.2.0`.

## [0.1.0] - 2026-07-12

### Added
- `capforge init` — create `~/.capforge` (ed25519 keypair, skill store, config).
- `capforge forge --task <path|json|->` — the observe → synthesize → test → sign → provenance loop; writes a candidate `SKILL.md` to `~/.capforge/skills/<id>/`. The test gate refuses to sign a skill that fails its own test.
- `capforge verify <id>` — reports test-pass + signature-valid (ed25519) on a forged skill; detects body tampering.
- `capforge list` / `capforge promote <id>` / `capforge ui` — store listing, promote-to-`~/.claude/skills/`, and a local Hono forge UI with a capability graph + promote button.
- **ForgeRecord** primitive — a tested, signed, provenance-tagged unit of agent capability, embedded as a `<!-- capforge:provenance -->` block inside the SKILL.md so signed skills stay portable and self-contained.
- BYO-LLM-key synthesis via the Vercel AI SDK (Anthropic / OpenAI), plus a deterministic `--mock` synthesizer for offline, test, and demo runs.
- Animated dark/light hero + architecture SVGs, bilingual README (en + zh-CN), a vhs-rendered demo gif, and CI / release / demo GitHub Actions workflows.
