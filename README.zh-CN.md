# Codex Timewarp

[English](./README.md) | [简体中文](./README.zh-CN.md)

从具体出错的 prompt、assistant message、tool call 或 tool result 恢复 Codex 运行，而不是重启整个长任务。

`codex-timewarp` 是一个 Codex 插件 marketplace 仓库，里面包含 `timewarp` 插件。它是一个 TypeScript/Node MVP，用来检查 Codex session transcript，并生成安全的恢复 prompt。

## 解决什么问题

长时间 agent run 经常不是整体失败，而是在某个具体点出错：

- 某个 prompt 把任务带偏了
- 模型选错了工具
- 工具调用参数错了
- 工具结果不完整、过期或误导
- 模型误读了工具结果
- 后续 patch 修改了不该修改的文件

重启整个任务会浪费上下文和时间。Timewarp 可以让你检查 session 时间线，定位出错事件，并从那个精确边界生成恢复 prompt。

## 功能

- 解析 `$CODEX_HOME/sessions` 或 `~/.codex/sessions` 下的 Codex JSONL session。
- 把 transcript 事件标准化成稳定 ID，例如 `E001`。
- 按 user/task turn 分组展示事件。
- 通过 `call_id` 关联工具调用和工具结果。
- 检查 prompt、message、工具调用、工具结果和 patch 事件。
- 标记副作用风险：`read_only`、`local_workspace_mutation`、`external_side_effect` 或 `unknown`。
- 生成 transcript-only 恢复 prompt。
- 把手动修正的工具结果写入 `$CODEX_HOME/timewarp/overrides/`。

Timewarp 不会改写原始 session 文件，不会恢复工作区文件，也不会自动重跑有副作用的工具。

## 仓库结构

```text
.agents/plugins/marketplace.json
package.json
README.md
README.zh-CN.md
plugins/timewarp/
  .codex-plugin/plugin.json
  skills/timewarp/SKILL.md
  bin/timewarp.ts
  hooks/hooks.json
  hooks/timewarp-hook.ts
  src/
  test/
```

仓库根目录就是 marketplace 根目录。`plugins/timewarp/` 是插件根目录。

## 作为 Codex 插件安装

使用 SSH 从 GitHub 安装。私有仓库，或者本机已经配置 GitHub SSH key 时，优先用这种方式：

```sh
codex plugin marketplace add git@github.com:pinksky13/codex-timewarp.git --ref main
codex plugin add timewarp@codex-timewarp
```

然后重启 Codex，让 plugin skills 和 hooks 重新加载。

如果仓库是 public，并且你的环境可以通过 HTTPS clone GitHub，也可以用简写形式：

```sh
codex plugin marketplace add pinksky13/codex-timewarp --ref main
codex plugin add timewarp@codex-timewarp
```

如果只想测试安装流程，不想修改真实 Codex 配置：

```sh
mkdir -p /tmp/timewarp-codex-home
CODEX_HOME=/tmp/timewarp-codex-home codex plugin marketplace add git@github.com:pinksky13/codex-timewarp.git --ref main
CODEX_HOME=/tmp/timewarp-codex-home codex plugin add timewarp@codex-timewarp
CODEX_HOME=/tmp/timewarp-codex-home codex plugin list --marketplace codex-timewarp
```

## 快速开始

clone 仓库后，在仓库根目录运行：

```sh
git clone git@github.com:pinksky13/codex-timewarp.git
cd codex-timewarp
npm run check
npm run timewarp -- show --latest --tools-only --limit 20
```

`npm run check` 会运行语法检查和测试。`npm run timewarp -- show ...` 会展示最新 Codex session 里最近的工具相关事件。

## 常用命令

查看最新时间线：

```sh
npm run timewarp -- show --latest --limit 30
```

只看工具相关事件：

```sh
npm run timewarp -- show --latest --tools-only --limit 30
```

检查单个事件：

```sh
npm run timewarp -- inspect E528 --latest
```

生成“从坏事件之前继续”的恢复 prompt：

```sh
npm run timewarp -- prompt --before E528 --latest
```

生成“从某事件之后继续”的恢复 prompt：

```sh
npm run timewarp -- prompt --after E528 --latest
```

写入手动修正的工具结果：

```sh
npm run timewarp -- override E529 --latest --replacement "Corrected tool output goes here."
```

用于自动化的 JSON 输出：

```sh
npm run timewarp -- show --latest --tools-only --json
npm run timewarp -- inspect E528 --latest --json
```

## 在 Codex 中使用

这个 MVP 不假设 Codex 已支持插件注册原生 slash command。插件提供的是 `timewarp` skill 和 CLI。

在 Codex 里可以这样说：

```text
Use timewarp to show the latest timeline and focus on tool-related events.
```

或者让 Codex 直接运行 CLI：

```text
Run: npm run timewarp -- show --latest --tools-only --limit 20
```

## 推荐工作流

1. 运行 `show --latest --tools-only` 找到可疑事件。
2. 对可疑 prompt、调用或结果运行 `inspect <event-id>`。
3. 如果要从某个 transcript 边界继续，运行 `prompt --before <event-id>` 或 `prompt --after <event-id>`。
4. 如果某个工具结果错误或不完整，运行 `override <event-id> --replacement ...`。
5. 把生成的恢复 prompt 交给 Codex 使用。

## 最佳实践

- 恢复前优先用 `inspect` 看详情，不要只根据短 preview 判断。
- 对 `unknown` 和 `local_workspace_mutation` 风险保持保守。
- 当工作区可能已经包含后续文件变更时，优先使用 `prompt` 做 transcript-only 恢复。
- 当工具结果过期、不完整或误导，但不需要回滚文件时，使用 `override`。
- `replacement` 文本尽量短、事实化、具体。
- 不要把这个 MVP 当成“文件已经回滚到历史状态”的证明。
- 不要静默重跑会修改本地文件、部署、push、发帖或发邮件的命令。

## 安全模型

`prompt` 和类似 `fork` 的恢复只生成文本，不会修改 Codex transcript。

`override` 会把合成 override 事件写入插件自己的状态目录：

```text
$CODEX_HOME/timewarp/overrides/<session_id>.jsonl
```

`~/.codex/sessions/**/rollout-*.jsonl` 下的原始 session 文件不会被修改。

## MVP 限制

- 不支持自动工作区恢复。
- 不支持精确时间点文件回滚。
- 不自动重跑有副作用的工具。
- 不保证已经注册原生 `/timewarp` slash command。
- 不支持外部副作用回滚。

## License

MIT
