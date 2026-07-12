<div align="right"><sub><a href="./README.md">English</a>&nbsp;&nbsp;⇄&nbsp;&nbsp;<b>简体中文</b></sub></div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/hero-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/hero-light.svg">
  <img src="./assets/hero-light.svg" width="880" alt="capforge — 面向 agentic coding agent 的即时能力锻造炉">
</picture>

<p align="center"><sub>capforge 是为 agentic coding agent 合成「已测试、已签名」skill 的锻造炉。</sub></p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-5E5CE6" alt="license"></a>
  <a href="https://github.com/SuperMarioYL/capforge/releases/latest"><img src="https://img.shields.io/github/v/release/SuperMarioYL/capforge?color=10A37F&label=release" alt="latest release"></a>
  <a href="https://github.com/SuperMarioYL/capforge/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SuperMarioYL/capforge/ci.yml?branch=main&label=ci" alt="CI"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520.10-5E5CE6" alt="node">
  <img src="https://img.shields.io/badge/Skill-tested%20%26%20signed-10A37F" alt="Skill">
</p>

**当你的 agent 装了上千个 skill 仍然失败时——capforge 会锻造出它缺少的那个，测试、签名，再晋升进你的库里。**

<h2><img src="https://api.iconify.design/tabler:topology-star-3.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 架构</h2>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/atlas-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/atlas-light.svg">
  <img src="./assets/atlas-light.svg" width="880" alt="架构：task.json → forge-core → skill-store，以及 forge-ui → ~/.claude/skills">
</picture>

一个 Node 二进制，三个逻辑组件，没有微服务，没有容器：

- **forge-core** —— 自有协议：**观察**任务上下文 → 用你自己的 Anthropic/OpenAI 模型（自带 key）**合成**候选 `SKILL.md` → 在临时目录沙箱里针对 `example_inputs` **测试** → 本地 ed25519 **签名** → 嵌入 **provenance** 溯源块。通不过自身测试的 skill 永不被签名。
- **forge-ui** —— 本地 Hono 服务 + 单页前端。可视化整条回路，审查测试轨迹与签名，一键晋升。
- **skill-store** —— 本地文件系统（`~/.capforge/skills/`）。无数据库，除你自己的 LLM API 外不联网。

<h2><img src="https://api.iconify.design/tabler:bulb.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 为什么需要它</h2>

你的 agent 装了 1,935+ 个 skill（[sickn33/agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills)），却仍会在没人专门策划过 skill 的任务上卡住。可安装 skill 的浪潮正以每天 1,300★ 的速度增长（[affaan-m/ECC](https://github.com/affaan-m/ECC)）——覆盖缺口已是常态，而非边缘情况。静态库装的是人类已经写好的 skill；capforge 为**没有任何已策划 skill 覆盖**的任务现场创造一个。capforge 拥有的单元是 **ForgeRecord**：一个「已测试、已签名」的 agent 能力单元——它不是对已存在 skill 的加载期证明，而是对一个全新 skill 的运行时合成 + 证明。测试把守签名，签名让篡改可见，溯源让一切可审计。

<h2><img src="https://api.iconify.design/tabler:rocket.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 安装与快速开始</h2>

```bash
npm i -g capforge
capforge init
capforge forge --task examples/task-slugify.json --mock
```

<details><summary>示例输出</summary>

```
$ capforge forge --task examples/task-slugify.json --mock
forged skill: slugify-a-string-a3c15efc
  dir:        ~/.capforge/skills/slugify-a-string-a3c15efc
  model:      capforge-mock
  test:       PASS  (3 examples)
  signed:     ed25519 b082eed28c375762…
  sig:        f66ad7aeb1a026ea1e721eee…
  provenance: embedded in SKILL.md

  verify:     capforge verify slugify-a-string-a3c15efc
```
</details>

`--mock` 标志在无 API key 的情况下跑完整条回路（一个确定性离线合成器），3 条命令即可看到 forge → test → sign → provenance 全流程。去掉 `--mock` 并设置 `ANTHROPIC_API_KEY`（或 `OPENAI_API_KEY`），让你的模型来合成 skill。

<h2><img src="https://api.iconify.design/tabler:terminal-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 用法</h2>

```bash
# 用你自己的模型锻造（自带 key，去掉 --mock）
export ANTHROPIC_API_KEY=sk-…
capforge init
capforge forge --task my-task.json
capforge verify <id>        # 报告 test-pass + signature-valid
capforge list                # 能力库，带 test + sig 徽章
capforge promote <id>        # 把已签名 skill 复制进 ~/.claude/skills/
capforge ui                  # 本地 skill-forge UI，http://127.0.0.1:7777
```

任务是一小段 JSON，描述你的 agent 刚刚在哪一步失败：

```json
{
  "goal": "slugify a string",
  "available_tools": ["Bash", "Read", "Write"],
  "available_skills": [],
  "example_inputs": ["Hello World", "Foo Bar Baz!"],
  "expected_assert": "[ -n \"$OUTPUT\" ] && case \"$OUTPUT\" in *[!a-z0-9-]*) false;; esac"
}
```

| 字段 | 含义 |
|---|---|
| `goal` | agent 没能做到的事 |
| `available_tools` | agent 已有的工具（Bash、Read 等） |
| `available_skills` | 已安装的 skill（帮合成器避免重复造轮子） |
| `example_inputs` | 用来测试被锻造 skill 的输入 |
| `expected_assert` | shell 断言；带 `INPUT`/`OUTPUT`/`EXIT` 环境变量退出 0 即通过 |

测试步骤会在一个带超时的临时目录里，针对每个 `example_input` 运行被合成 skill 的 shell 包装脚本，再执行 `expected_assert`。通不过自身测试的 skill 永不被签名——`capforge verify` 对它报告 `signature-invalid`。

<h2><img src="https://api.iconify.design/tabler:photo.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 演示</h2>

![demo](assets/demo.gif)

20 秒回路：`init` → `forge --mock`（observe → synthesize → test → sign → provenance）→ `list` → `verify`（test-pass + signature-valid）→ `promote`（进入 `~/.claude/skills/`）。用 [vhs](https://github.com/charmbracelet/vhs) 录制；可经 `demo` 工作流按需重渲。

<h2><img src="https://api.iconify.design/tabler:adjustments.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 配置</h2>

`~/.capforge/config.json`（由 `capforge init` 写入）：

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `provider` | `"anthropic"` \| `"openai"` \| `"auto"` | `"auto"` | 用哪个模型合成（`auto` 选已设置 key 的那个） |
| `model` | string \| null | `null` | 覆盖默认模型 id（`claude-sonnet-4-5` / `gpt-4o`） |

环境变量：

| 变量 | 含义 |
|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 自带模型 key，锻造时读取 |
| `CAPFORGE_HOME` | 覆盖 `~/.capforge`（store + keypair + config） |
| `CLAUDE_SKILLS_DIR` | 覆盖 `~/.claude/skills`（promote 目标） |
| `CLAUDE_CODE_VERSION` | 盖印进 ForgeRecord 的 `origin` 块 |

<h2><img src="https://api.iconify.design/tabler:map-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 路线图</h2>

- [x] **m1 —— 合成**：`capforge forge --task task.json` 读取任务、调用你的 LLM（自带 key）、写出候选 `SKILL.md`。
- [x] **m2 —— 测试、签名、溯源**：针对 `example_inputs` 沙箱测试、ed25519 签名、嵌入 `<!-- capforge:provenance -->` 块；`capforge verify` 报告 test-pass + signature-valid。
- [x] **m3 —— forge UI**：本地 Hono 页面，能力图 + 晋升为永久 skill 的路径。
- [ ] **v0.2** —— 运行时钩子：从 Claude Code 内部自动观察任务（无需粘贴 `task.json`）。
- [ ] **v0.3** —— 多 harness（Codex / Cursor / Opencode）与 MCP-server / 浏览器工具型 skill。
- [ ] **以后** —— 已锻造 skill 注册表、跨组织溯源信任图、托管签名服务。

<h2><img src="https://api.iconify.design/tabler:chart-bar.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 对比静态 skill 库</h2>

| | capforge | [agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills) |
|---|---|---|
| 为未覆盖任务创造 skill | ✓ 运行时 | — 只装人类已策划的 |
| 使用前测试 | ✓ 沙箱测试把守签名 | — |
| 签名 + 溯源 | ✓ ed25519，嵌入 SKILL.md | — |
| 开箱广度 | — 无预装 | ✓ 1,935+ 个 skill |
| 人工策展质量 | 部分（模型生成、经测试） | ✓ 人工策展 |
| 安装体验 | ✓ `npm i -g` + 3 条命令 | ✓ 安装器 CLI |

诚实评价：策展库在广度与策展质量上胜出；capforge 是针对没有任何库覆盖的任务的长尾兜底。二者可组合——锻造一个 skill，再把它回流给库。

<h2><img src="https://api.iconify.design/tabler:license.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 许可</h2>

MIT —— 见 [LICENSE](./LICENSE)。欢迎在 [SuperMarioYL/capforge](https://github.com/SuperMarioYL/capforge/issues) 提 issue 或 PR。

## 分享

```
capforge —— 面向 Claude Code 的 agentic skill 锻造炉，当 agent 撞上 1,935 个 skill 都没覆盖的任务时，现场合成一个已测试、已签名的 Skill。 https://github.com/SuperMarioYL/capforge
```

<p align="center"><sub><a href="./LICENSE">MIT</a> © 2026 SuperMarioYL</sub></p>
