# Codex Timewarp / Codex 时间回溯

`rec/` is a local Codex marketplace. It contains the `timewarp` plugin, a TypeScript/Node MVP for tool-call-level recovery over Codex session transcripts.

`rec/` 是一个本地 Codex marketplace，里面包含 `timewarp` 插件。这个插件是一个 TypeScript/Node MVP，用来读取 Codex 会话 transcript，并在工具调用层面做检查和安全恢复辅助。

## What It Does / 功能

Timewarp implements the safe v1 slice from `docs/tool-call-recovery-plugin-design.md`.

Timewarp 实现的是 `docs/tool-call-recovery-plugin-design.md` 中安全的 v1 MVP 范围。

- Parse Codex JSONL sessions under `$CODEX_HOME/sessions` or `~/.codex/sessions`.
- Normalize events into stable IDs like `E001`.
- Group events by user/task turn.
- Link tool calls to tool results by `call_id`.
- Inspect tool call/result details with raw transcript references.
- Classify side-effect risk: `read_only`, `local_workspace_mutation`, `external_side_effect`, or `unknown`.
- Generate transcript-only recovery prompts.
- Store manual tool-result overrides under `$CODEX_HOME/timewarp/overrides/`.

- 解析 `$CODEX_HOME/sessions` 或 `~/.codex/sessions` 下的 Codex JSONL 会话。
- 把事件标准化成稳定 ID，例如 `E001`。
- 按用户任务 turn 分组展示事件。
- 通过 `call_id` 关联工具调用和工具结果。
- 查看工具调用/结果详情，并显示原始 transcript 文件和行号。
- 标记副作用风险：`read_only`、`local_workspace_mutation`、`external_side_effect` 或 `unknown`。
- 生成 transcript-only 恢复 prompt。
- 把手动修正的工具结果写到 `$CODEX_HOME/timewarp/overrides/`。

It intentionally does not rewrite original session files, restore workspace files, or rerun mutating tools automatically.

它不会改写原始 session 文件，不会回滚工作区文件，也不会自动重跑有副作用的工具。

## Layout / 目录结构

```text
rec/
  .agents/plugins/marketplace.json
  package.json
  README.md
  plugins/timewarp/
    .codex-plugin/plugin.json
    skills/timewarp/SKILL.md
    bin/timewarp.ts
    hooks/hooks.json
    hooks/timewarp-hook.ts
    src/
    test/
```

`rec/` is the marketplace root. `rec/plugins/timewarp/` is the plugin root.

`rec/` 是 marketplace 根目录，`rec/plugins/timewarp/` 是插件根目录。

## Quick Start / 快速开始

Run from the parent directory of `rec/`.

在 `rec/` 的父目录运行以下命令。

```sh
npm --prefix rec run check
npm --prefix rec run timewarp -- show --latest --tools-only --limit 20
```

The first command runs syntax checks and tests. The second command shows the latest Codex session's recent tool-call timeline.

第一条命令运行语法检查和测试。第二条命令展示最新 Codex 会话中最近的工具调用时间线。

## Common Commands / 常用命令

Show the latest timeline:

查看最新时间线：

```sh
npm --prefix rec run timewarp -- show --latest --limit 30
```

Show only tool-related events:

只看工具相关事件：

```sh
npm --prefix rec run timewarp -- show --latest --tools-only --limit 30
```

Inspect one event:

检查单个事件：

```sh
npm --prefix rec run timewarp -- inspect E528 --latest
```

Generate a recovery prompt from before a bad event:

生成“从坏事件之前继续”的恢复 prompt：

```sh
npm --prefix rec run timewarp -- prompt --before E528 --latest
```

Generate a recovery prompt from after an event:

生成“从某事件之后继续”的恢复 prompt：

```sh
npm --prefix rec run timewarp -- prompt --after E528 --latest
```

Write a manual tool-result override:

写入手动修正的工具结果：

```sh
npm --prefix rec run timewarp -- override E529 --latest --replacement "Corrected tool output goes here."
```

Machine-readable output:

机器可读输出：

```sh
npm --prefix rec run timewarp -- show --latest --tools-only --json
npm --prefix rec run timewarp -- inspect E528 --latest --json
```

## Install As A Codex Plugin / 作为 Codex 插件安装

To install into the real Codex environment:

安装到真实 Codex 环境：

```sh
codex plugin marketplace add /Users/zhouziyan/intel/learning/rec
codex plugin add timewarp@timewarp-local
```

Then restart Codex so plugin skills and hooks are reloaded.

然后重启 Codex，让插件 skill 和 hook 重新加载。

For safe install testing without touching your real Codex config:

如果只想安全测试安装流程，不修改真实 Codex 配置：

```sh
mkdir -p /tmp/timewarp-codex-home
CODEX_HOME=/tmp/timewarp-codex-home codex plugin marketplace add "$(pwd)/rec"
CODEX_HOME=/tmp/timewarp-codex-home codex plugin add timewarp@timewarp-local
CODEX_HOME=/tmp/timewarp-codex-home codex plugin list --marketplace timewarp-local
```

## Using Inside Codex / 在 Codex 中使用

Native slash-command registration is not assumed in this MVP. The plugin exposes a `timewarp` skill and a CLI.

这个 MVP 不假设 Codex 已支持插件注册原生 slash command。插件提供的是 `timewarp` skill 和 CLI。

In Codex, you can ask:

在 Codex 里可以这样说：

```text
Use timewarp to show the latest tool timeline.
```

Or ask Codex to run the CLI directly:

或者让 Codex 直接运行 CLI：

```text
Run: npm --prefix rec run timewarp -- show --latest --tools-only --limit 20
```

## Recommended Workflow / 推荐工作流

1. Run `show --latest --tools-only` to locate suspicious tool calls.
2. Run `inspect <event-id>` on the suspected call or result.
3. If the transcript should continue from a boundary, run `prompt --before <event-id>` or `prompt --after <event-id>`.
4. If a tool result was wrong or incomplete, run `override <event-id> --replacement ...`.
5. Paste or use the generated recovery prompt in Codex.

1. 先运行 `show --latest --tools-only` 找到可疑工具调用。
2. 对可疑调用或结果运行 `inspect <event-id>`。
3. 如果要从某个边界继续，运行 `prompt --before <event-id>` 或 `prompt --after <event-id>`。
4. 如果某个工具结果错误或不完整，运行 `override <event-id> --replacement ...`。
5. 把生成的恢复 prompt 交给 Codex 继续执行。

## Best Practices / 最佳实践

- Prefer `inspect` before recovery. Do not recover from an event ID based only on a short preview.
- Treat `unknown` and `local_workspace_mutation` risk labels conservatively.
- Use `prompt` for transcript-only recovery when the workspace may already contain later file changes.
- Use `override` when the tool result is stale, incomplete, or misleading, but the workspace does not need rollback.
- Keep replacement text short, factual, and specific.
- Do not use this MVP as proof that files were restored to an earlier state.
- Do not silently rerun mutating commands, deploys, pushes, posts, or email-sending commands.

- 恢复前优先用 `inspect` 看详情，不要只根据短 preview 判断。
- 对 `unknown` 和 `local_workspace_mutation` 风险保持保守。
- 当工作区可能已经包含后续文件变更时，优先使用 `prompt` 做 transcript-only 恢复。
- 当工具结果过期、不完整或误导，但不需要回滚文件时，使用 `override`。
- `replacement` 文本尽量短、事实化、具体。
- 不要把这个 MVP 当成“文件已经回滚到历史状态”的证明。
- 不要静默重跑会修改本地文件、部署、push、发帖或发邮件的命令。

## Safety Model / 安全模型

`prompt` and `fork` style recovery only generate text. They do not mutate Codex transcripts.

`prompt` 和类似 `fork` 的恢复只生成文本，不会修改 Codex transcript。

`override` writes synthetic override events to plugin-owned state:

`override` 会把合成 override 事件写入插件自己的状态目录：

```text
$CODEX_HOME/timewarp/overrides/<session_id>.jsonl
```

The original files under `~/.codex/sessions/**/rollout-*.jsonl` are never modified.

`~/.codex/sessions/**/rollout-*.jsonl` 下的原始 session 文件不会被修改。

## Known MVP Limits / MVP 限制

- No automatic workspace restore.
- No exact point-in-time file rollback.
- No automatic rerun of mutating tools.
- No native `/timewarp` slash command registration guarantee.
- No external side-effect rollback.

- 不支持自动工作区恢复。
- 不支持精确时间点文件回滚。
- 不自动重跑有副作用的工具。
- 不保证已经注册原生 `/timewarp` slash command。
- 不支持外部副作用回滚。
