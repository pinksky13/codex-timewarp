# Codex Timewarp

[English](./README.md) | [Simplified Chinese](./README.zh-CN.md)

Recover Codex runs from the exact bad prompt, assistant message, tool call, or tool result instead of restarting the whole task.

`codex-timewarp` is a Codex plugin marketplace repository for the `timewarp` plugin. It inspects local Codex session transcripts, helps you find the bad event, and generates safe transcript-only recovery prompts.

## Recommended Default Flow

If you want the default Timewarp experience inside Codex, start here:

Timewarp is currently distributed as a Codex plugin marketplace, not as an npm package. The install command registers the GitHub repository with Codex and then installs the plugin from that marketplace.

```sh
codex plugin marketplace add git@github.com:pinksky13/codex-timewarp.git --ref main
codex plugin add timewarp@codex-timewarp
```

Restart Codex so plugin skills and hooks are reloaded, then ask:

```text
Use timewarp to show the latest timeline and focus on tool-related events.
```

If the repository is public and your environment can clone from GitHub over HTTPS, the shorthand form also works:

```sh
codex plugin marketplace add pinksky13/codex-timewarp --ref main
codex plugin add timewarp@codex-timewarp
```

Do not clone this repository for normal use. Clone it only if you want to develop Timewarp or manually run the local CLI.

## A Simple Mental Model

Timewarp does not replace Codex.

It adds an inspection and recovery layer around Codex session transcripts:

- Codex runs the task and writes JSONL sessions.
- Timewarp reads the local session timeline.
- You inspect the exact prompt, assistant message, tool call, or tool result that went wrong.
- Timewarp generates a continuation prompt or records a manual tool-result override.

Timewarp intentionally does not restore workspace files, rewrite original session files, or rerun mutating tools automatically.

## Start Here If You Are New

1. Install the plugin with the recommended flow above.
2. Restart Codex.
3. Ask Codex to use `timewarp` and show the latest tool-related timeline.
4. Inspect the suspicious event ID before choosing a recovery action.
5. Generate a recovery prompt from before or after the chosen event.

## What It Solves

Long agent runs often fail at one specific point:

- a prompt sent the run in the wrong direction
- the model chose the wrong tool
- a tool call used bad arguments
- a tool result was incomplete, stale, or misleading
- the model misread a tool result
- a later patch changed files you did not intend to change

Restarting the whole task wastes context and time. Timewarp lets you inspect the session timeline, locate the bad event, and generate a recovery prompt from that exact boundary.

## Features

- Parse Codex JSONL sessions under `$CODEX_HOME/sessions` or `~/.codex/sessions`.
- Normalize transcript events into stable IDs like `E001`.
- Group events by user/task turn.
- Link tool calls to tool results by `call_id`.
- Inspect prompts, messages, tool calls, tool results, and patch events.
- Classify side-effect risk: `read_only`, `local_workspace_mutation`, `external_side_effect`, or `unknown`.
- Generate transcript-only recovery prompts.
- Store manual tool-result overrides under `$CODEX_HOME/timewarp/overrides/`.

## Recommended Workflow

Installed plugin users can ask Codex to perform these Timewarp actions; local development users can run the same actions with `npm run timewarp -- ...`.

1. Run `show --latest --tools-only` to locate suspicious events.
2. Run `inspect <event-id>` on the suspected prompt, call, or result.
3. If the transcript should continue from a boundary, run `prompt --before <event-id>` or `prompt --after <event-id>`.
4. If a tool result was wrong or incomplete, run `override <event-id> --replacement ...`.
5. Use the generated recovery prompt in Codex.

## Development

Clone the repository only when you want to develop Timewarp or run the CLI by hand:

```sh
git clone git@github.com:pinksky13/codex-timewarp.git
cd codex-timewarp
npm run check
npm run timewarp -- show --latest --tools-only --limit 20
```

`npm run check` runs syntax checks and tests. `npm run timewarp -- show ...` shows recent tool-related events from the latest Codex session.

## Local CLI Reference

These commands are for a cloned checkout. Installed plugin users should usually ask Codex to use `timewarp` instead of running `npm` manually.

Show the latest timeline:

```sh
npm run timewarp -- show --latest --limit 30
```

Show only tool-related events:

```sh
npm run timewarp -- show --latest --tools-only --limit 30
```

Inspect one event:

```sh
npm run timewarp -- inspect E528 --latest
```

Generate a recovery prompt from before a bad event:

```sh
npm run timewarp -- prompt --before E528 --latest
```

Generate a recovery prompt from after an event:

```sh
npm run timewarp -- prompt --after E528 --latest
```

Write a manual tool-result override:

```sh
npm run timewarp -- override E529 --latest --replacement "Corrected tool output goes here."
```

Use JSON output for automation:

```sh
npm run timewarp -- show --latest --tools-only --json
npm run timewarp -- inspect E528 --latest --json
```

## Install Verification

To test installation without touching your real Codex config:

```sh
mkdir -p /tmp/timewarp-codex-home
CODEX_HOME=/tmp/timewarp-codex-home codex plugin marketplace add git@github.com:pinksky13/codex-timewarp.git --ref main
CODEX_HOME=/tmp/timewarp-codex-home codex plugin add timewarp@codex-timewarp
CODEX_HOME=/tmp/timewarp-codex-home codex plugin list --marketplace codex-timewarp
```

## Best Practices

- Prefer `inspect` before recovery. Do not recover from an event ID based only on a short preview.
- Treat `unknown` and `local_workspace_mutation` risk labels conservatively.
- Use `prompt` for transcript-only recovery when the workspace may already contain later file changes.
- Use `override` when the tool result is stale, incomplete, or misleading, but the workspace does not need rollback.
- Keep replacement text short, factual, and specific.
- Do not use this MVP as proof that files were restored to an earlier state.
- Do not silently rerun mutating commands, deploys, pushes, posts, or email-sending commands.

## Safety Model

`prompt` and `fork` style recovery only generate text. They do not mutate Codex transcripts.

`override` writes synthetic override events to plugin-owned state:

```text
$CODEX_HOME/timewarp/overrides/<session_id>.jsonl
```

The original files under `~/.codex/sessions/**/rollout-*.jsonl` are never modified.

## MVP Limits

- No automatic workspace restore.
- No exact point-in-time file rollback.
- No automatic rerun of mutating tools.
- No native `/timewarp` slash command registration guarantee.
- No external side-effect rollback.

## Repository Layout

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

The repository root is the marketplace root. `plugins/timewarp/` is the plugin root.

## License

MIT
