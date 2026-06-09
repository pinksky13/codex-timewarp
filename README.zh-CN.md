# Codex Timewarp

[English](./README.md) | [简体中文](./README.zh-CN.md)

从具体出错的 prompt、assistant message、tool call 或 tool result 恢复 Codex 运行，而不是重启整个长任务。

`codex-timewarp` 是一个 Codex 插件 marketplace 仓库，里面包含 `timewarp` 插件。它会检查本地 Codex session transcript，帮你定位出错事件，并生成用于干净新会话的恢复包。

## 推荐默认流程

如果你想在 Codex 里获得默认 Timewarp 体验，从这里开始：

先安装 npm 入口，再让它注册并安装 Codex 插件：

```sh
npm install -g codex-timewarp
codex-timewarp install
```

重启 Codex，让 plugin skills 和 hooks 重新加载，然后在 Codex 里说：

```text
Use timewarp to show the latest timeline and focus on tool-related events.
```

如果你不想安装 npm 入口，也可以直接运行 Codex plugin 命令：

```sh
codex plugin marketplace add git@github.com:pinksky13/codex-timewarp.git --ref main
codex plugin add timewarp@codex-timewarp
```

如果仓库是 public，并且你的环境可以通过 HTTPS clone GitHub，npm 和直接安装都支持 HTTPS 简写：

```sh
codex-timewarp install --https
codex plugin marketplace add pinksky13/codex-timewarp --ref main
```

正常使用不需要 clone 这个仓库。只有开发 Timewarp，或者手动跑本地 CLI 时，才需要 clone。

## 一个简单心智模型

Timewarp 不替代 Codex。

它是在 Codex session transcript 外面加了一层检查和恢复能力：

- Codex 执行任务，并写入 JSONL session。
- Timewarp 读取本地 session 时间线。
- 你检查具体出错的 prompt、assistant message、tool call 或 tool result。
- Timewarp 生成用于干净 Codex 新会话的 restart 恢复包，或者记录手动修正的工具结果。

Timewarp 不会恢复工作区文件，不会改写原始 session 文件，也不会自动重跑有副作用的工具。

## 新用户从这里开始

1. 按上面的推荐默认流程安装插件。
2. 重启 Codex。
3. 让 Codex 使用 `timewarp` 展示最新工具相关时间线。
4. 先 inspect 可疑事件 ID，再决定恢复动作。
5. 从选定事件之前或之后生成 `restart` 恢复包。
6. 开启 `/new` 或 `/clear`，粘贴整个恢复包，然后从选定边界继续。

## 解决什么问题

长时间 agent run 经常不是整体失败，而是在某个具体点出错：

- 某个 prompt 把任务带偏了
- 模型选错了工具
- 工具调用参数错了
- 工具结果不完整、过期或误导
- 模型误读了工具结果
- 后续 patch 修改了不该修改的文件

重启整个任务会浪费上下文和时间。Timewarp 可以让你检查 session 时间线，定位出错事件，并从那个精确边界生成用于干净新会话的恢复包。

## 功能

- 解析 `$CODEX_HOME/sessions` 或 `~/.codex/sessions` 下的 Codex JSONL session。
- 把 transcript 事件标准化成稳定 ID，例如 `E001`。
- 按 user/task turn 分组展示事件。
- 通过 `call_id` 关联工具调用和工具结果。
- 检查 prompt、message、工具调用、工具结果和 patch 事件。
- 标记副作用风险：`read_only`、`local_workspace_mutation`、`external_side_effect` 或 `unknown`。
- 生成用于干净 Codex 新会话的 `restart` 恢复包。
- 保留 `prompt` 作为显式接受当前会话软恢复时的选项。
- 把手动修正的工具结果写入 `$CODEX_HOME/timewarp/overrides/`。

## 推荐工作流

安装插件的用户可以让 Codex 执行这些 Timewarp 动作；本地开发用户可以用 `npm run timewarp -- ...` 运行同样的动作。

1. 运行 `show --latest --tools-only` 找到可疑事件。
2. 对可疑 prompt、调用或结果运行 `inspect <event-id>`。
3. 如果要从某个 transcript 边界继续，运行 `restart --before <event-id>` 或 `restart --after <event-id>`。
4. 如果某个工具结果错误或不完整，给 `restart` 传入 `--replacement ...`、`--replacement-file <path>` 或 `--stdin`。
5. 开启干净 Codex 会话：`/new` 或 `/clear`，粘贴整个恢复包，并在那里继续。

## 开发

只有开发 Timewarp，或者手动跑 CLI 时，才 clone 仓库：

```sh
git clone git@github.com:pinksky13/codex-timewarp.git
cd codex-timewarp
npm run check
npm run timewarp -- show --latest --tools-only --limit 20
```

`npm run check` 会运行语法检查和测试。`npm run timewarp -- show ...` 会展示最新 Codex session 里最近的工具相关事件。

## 本地 CLI 参考

这些命令用于 clone 下来的仓库。安装插件的普通用户通常应该让 Codex 使用 `timewarp`，而不是自己手动跑 `npm`。

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

生成“从坏事件之前继续”的干净新会话恢复包：

```sh
npm run timewarp -- restart --before E528 --latest
```

生成“从某事件之后继续”的干净新会话恢复包：

```sh
npm run timewarp -- restart --after E528 --latest
```

生成带修正工具结果的恢复包，并在剪贴板支持可用时复制：

```sh
npm run timewarp -- restart --after E529 --latest --replacement "Corrected tool output goes here." --copy
```

只有在你明确接受当前污染会话里的软恢复时，才生成 soft recovery prompt：

```sh
npm run timewarp -- prompt --before E528 --latest
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

## 安装验证

如果只想测试安装流程，不想修改真实 Codex 配置：

```sh
mkdir -p /tmp/timewarp-codex-home
CODEX_HOME=/tmp/timewarp-codex-home codex-timewarp install
CODEX_HOME=/tmp/timewarp-codex-home codex plugin list --marketplace codex-timewarp
```

## 最佳实践

- 恢复前优先用 `inspect` 看详情，不要只根据短 preview 判断。
- 对 `unknown` 和 `local_workspace_mutation` 风险保持保守。
- 恢复、rewind 或干净 continuation 时，优先使用 `restart`。
- 只有在明确接受当前会话软恢复时，才使用 `prompt`。
- 只有在明确需要插件自有 override 状态时，才使用 `override`。
- `replacement` 文本尽量短、事实化、具体。
- 不要把这个 MVP 当成“文件已经回滚到历史状态”的证明。
- 不要静默重跑会修改本地文件、部署、push、发帖或发邮件的命令。

## 安全模型

`restart`、`prompt` 和类似 `fork` 的恢复只生成文本，不会修改 Codex transcript。

`restart` 是推荐的 hard recovery 流程。它生成的恢复包应该贴到新的 `/new` 或 `/clear` 会话，不应该贴回旧的污染会话。

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

## 仓库结构

```text
.agents/plugins/marketplace.json
bin/codex-timewarp.js
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

## License

MIT
