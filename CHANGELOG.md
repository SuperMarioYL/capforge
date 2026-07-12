# Changelog

All notable changes to capforge are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-12

### Added
- `capforge init` — create `~/.capforge` (ed25519 keypair, skill store, config).
- `capforge forge --task <path|json|->` — the observe → synthesize → test → sign → provenance loop; writes a candidate `SKILL.md` to `~/.capforge/skills/<id>/`. The test gate refuses to sign a skill that fails its own test.
- `capforge verify <id>` — reports test-pass + signature-valid (ed25519) on a forged skill; detects body tampering.
- `capforge list` / `capforge promote <id>` / `capforge ui` — store listing, promote-to-`~/.claude/skills/`, and a local Hono forge UI with a capability graph + promote button.
- **ForgeRecord** primitive — a tested, signed, provenance-tagged unit of agent capability, embedded as a `<!-- capforge:provenance -->` block inside the SKILL.md so signed skills stay portable and self-contained.
- BYO-LLM-key synthesis via the Vercel AI SDK (Anthropic / OpenAI), plus a deterministic `--mock` synthesizer for offline, test, and demo runs.
- Animated dark/light hero + architecture SVGs, bilingual README (en + zh-CN), a vhs-rendered demo gif, and CI / release / demo GitHub Actions workflows.
