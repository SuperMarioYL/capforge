[简体中文](./README.zh-CN.md) · [Website](https://capforge.lei6393.com) · [GitHub](https://github.com/SuperMarioYL/capforge)

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/hero-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/hero-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/hero-dark.svg">
  <img src="./assets/presentation/hero-light.svg" width="960" alt="Hero diagram">
</picture>

# capforge

**Turn a missing skill into a tested artifact.**

capforge turns an explicit task and example inputs into a candidate skill, runs its assertions, and signs successful results with local provenance.

## Why use it

A skill library can miss the task in front of you. Describe that task with examples and an assertion so a new candidate has something concrete to satisfy before promotion.

- **Examples define success** — Assertions give the generated skill a concrete acceptance condition.
- **Keep provenance with the skill** — Signed records include task, synthesis and test information.
- **Try the complete offline path** — The mock synthesizer needs no API key.

## Architecture

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/architecture-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-dark.svg">
  <img src="./assets/presentation/architecture-light.svg" width="960" alt="Architecture diagram">
</picture>

intake validates the task schema; synthesize creates a skill through an explicit provider or offline mock; the test runner executes example assertions in a temporary directory. Successful records are Ed25519-signed and saved to the local store. verify checks the persisted artifact; promote copies an accepted skill to the configured target.

| Component | Responsibility |
| --- | --- |
| `Task intake` | src/observe/intake.ts |
| `Synthesis` | src/forge/synthesize.ts |
| `Example tests` | src/forge/test.ts |
| `Signed record` | src/forge/provenance.ts |

## Install and quickstart

Build with the version declared in the repository manifest. Run the example from the repository root.

```bash
git clone https://github.com/SuperMarioYL/capforge.git
cd capforge
npm ci
npm run build
```

Run the shipped slugify task through the offline mock, real shell assertions and signature verification. No model key is required.

```bash
node examples/presentation-demo.mjs
```

## Recorded demo

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/process-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/process-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/process-dark.svg">
  <img src="./assets/presentation/process-light.svg" width="960" alt="Process diagram">
</picture>

The recorded slugify example passes its assertions and signature verification.

```text
{
  "goal": "slugify a string",
  "inputs": [
    "Hello World",
    "Foo Bar Baz!",
    "Café Résumé"
  ],
  "test_pass": true,
  "signed": true,
  "signature_valid": true,
  "model": "capforge-mock"
}
```

The complete command and output are recorded in [docs/demo-results.json](./docs/demo-results.json). Inputs and reproduction code are included in the repository.

![Existing terminal recording](./assets/demo.gif)

The existing recording is retained for context; the text example above documents the reproducible scenario.

## Usage

The CLI exposes the following operations. Commands after the example use your own paths or identifiers.

```bash
node dist/index.js forge --task examples/task-slugify.json --mock
node dist/index.js list
node dist/index.js verify <id>
node dist/index.js promote <id>
node dist/index.js ui
```

## Configuration

CAPFORGE_HOME selects the store, keypair and config directory. CLAUDE_SKILLS_DIR selects the promotion target. provider/model configure online synthesis; ANTHROPIC_API_KEY or OPENAI_API_KEY is read only when using that provider. The demo uses a temporary store and cleans up its own files.

## Integrations and responsibilities

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/integrations-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-dark.svg">
  <img src="./assets/presentation/integrations-light.svg" width="960" alt="Integrations diagram">
</picture>

The following routes are implemented in the source. Choose the input that matches your task and keep the resulting artifact with your project.

| Route | Implemented role |
| --- | --- |
| task.json | Goal, tools, examples and assertion |
| Anthropic / OpenAI | Optional configured synthesis providers |
| SKILL.md | Local skill and provenance |
| Ed25519 | Artifact signature verification |
| Local UI | Review and promotion |

## Limits and next steps

- The recorded demo uses deterministic mock synthesis. It proves the local test/sign/verify path, not model quality.
- A temporary working directory and timeout are not an OS security sandbox. Review generated shell code and assertions before running them.
- A valid signature establishes integrity relative to its key, not the safety or usefulness of a skill.

Runtime observation hooks and additional harness adapters remain future directions. Explicit task input is the current workflow.

## License and contributions

See [LICENSE](./LICENSE). When reporting an issue, include a minimal input, the command, and the observed output.
