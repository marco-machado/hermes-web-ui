# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Commands

- `npm run dev` — Vite dev server on `127.0.0.1:5173` (strictPort). Restart it after changing `.env.local`; Vite reads env only at process start.
- `npm run build` — `tsc -b` then `vite build`
- `npm run lint` — oxlint (config in `.oxlintrc.json`)
- `npm run smoke` — `scripts/smoke-connect.mjs`: WS connect + `session.create` against a running gateway. Run this first when debugging connection issues.

No test suite exists.

## Git conventions

Conventional Commits for messages and `type/short-description` for branch names, enforced by committed hooks in `.githooks/` plus the `.gitmessage` template. After a fresh clone, activate them once:

```bash
git config commit.template .gitmessage
git config core.hooksPath .githooks
```

## Hermes Agent source

The Hermes Agent repo lives at `/Users/machado/.hermes/hermes-agent/`. Consult it as ground truth for the gateway protocol: `tui_gateway/` (the JSON-RPC gateway this UI talks to; `gateway/` there is a different subsystem) and `docs/`. It is a Python project (`hermes serve` / `hermes dashboard` come from there).

### Gateway RPC surface

~125 methods, registered via `@method("...")` in `tui_gateway/*.py`. Enumerate the current list with:

```bash
grep -rhoE '@method\("[^"]+"\)' /Users/machado/.hermes/hermes-agent/tui_gateway/*.py | sed 's/@method("//;s/")//' | sort -u
```

Groups (this UI uses only the first):

- Core chat loop: `session.create`/`interrupt`/`status`, `prompt.submit`, `approval.respond`, `clarify.respond`, `sudo.respond`, `secret.respond`
- Session lifecycle: `session.list`/`resume`/`branch`/`close`/`delete`/`save`/`history`/`compress`/`undo`/`redirect`/`steer`/`title`/`usage`/`context_breakdown`/`cwd.set`/`activate`/`active_list`/`most_recent`
- Commands/completion: `commands.catalog`, `command.dispatch`, `command.resolve`, `slash.exec`, `complete.slash`, `complete.path`
- Attachments/input: `file.attach`, `image.attach`, `image.attach_bytes`, `image.detach`, `pdf.attach`, `clipboard.paste`, `paste.collapse`, `input.detect_drop`
- Tools/plugins/skills/processes: `tools.*`, `toolsets.list`, `plugins.*`, `skills.*`, `process.*`, `shell.exec`, `cli.exec`, `reload.mcp`, `reload.env`
- Models/config: `model.*`, `config.get`/`set`/`show`, `llm.oneshot`
- Projects/history safety: `projects.*`, `project.facts`, `rollback.list`/`diff`/`restore`, `spawn_tree.*`
- Orchestration: `agents.list`, `subagent.interrupt`, `delegation.*`, `handoff.*`, `prompt.background`
- Platform extras: `voice.*`, `wake.*`, `browser.manage`, `cron.manage`, `billing.*`, `subscription.*`, `usage.bars`, `insights.get`, `learning.*`, `pet.*`, `setup.*`, `verification.status`, `system.battery`, `terminal.resize`

Server-pushed events (frames with `method: "event"`): `message.start`/`delta`/`interim`/`complete`, `thinking.delta`, `tool.start`/`progress`/`complete`, `approval.request`, `clarify.request`, `sudo.request`, `secret.request`, `session.info`, `status.update`, `moa.*`, `browser.progress`, `cron.changed`, `error`.

The README's planned next builds map to: `session.list`/`resume`/`branch`, `commands.catalog` + `command.dispatch`, `file.attach`/`image.attach`.

## Prerequisites

A Hermes gateway must already be running (`hermes serve` or `hermes dashboard`, default `127.0.0.1:9119`). This app never starts it. Auth is a single per-process session token: set `HERMES_DASHBOARD_SESSION_TOKEN` before launching the gateway and mirror it in `VITE_HERMES_TOKEN` in `.env.local`, or scrape the live token (command in README/.env.example). A stale token makes the WS upgrade fail with 403.

## Architecture

Minimal React 19 client for Hermes Agent speaking the TUI gateway JSON-RPC protocol over WebSocket (`ws://HOST:PORT/api/ws?token=TOKEN`) — the same wire path as the official dashboard, not an OpenAI-style chat wrapper.

Three layers, strictly ordered:

1. `src/lib/json-rpc-gateway.ts` — vendored, wire-compatible subset of `@hermes/shared` `JsonRpcGatewayClient`. Raw WS + JSON-RPC: `request()` for calls, `on()`/`onAny()` for server-pushed events (frames with `method: "event"`). Keep this file protocol-only; it is the source of truth for the wire format.
2. `src/hooks/useHermesChat.ts` — the session/stream state machine. Wires gateway events into React state: message streaming (`message.start`/`delta`/`interim`/`complete`), tool timeline (`tool.start`/`progress`/`complete`), `approval.request`/`approval.respond`, `clarify.request`/`clarify.respond`, `session.interrupt`. All protocol interpretation lives here.
3. `src/App.tsx` — thin UI shell over the hook. `src/lib/types.ts` holds payload/UI types plus localStorage persistence of the connection form (`loadConnection`/`saveConnection`).

Grow the UI around gateway events, not around REST chat completions.

Protocol facts that shape the code:

- `prompt.submit` is fire-and-forget for completion: its RPC ack is not the answer. Completion comes from stream events, which is why the hook gives it a 30-minute timeout while other requests get 60s.
- Event payload field names vary by event (`tool_call_id` vs `tool_id` vs `id`, `args` vs `arguments`); `GatewayEventPayload` is a permissive union and helpers like `toolId()` normalize.
- Sessions are created and resumed with `close_on_disconnect: false`, `source: 'web'` — they persist in the gateway after the tab closes (reaped by the gateway's idle TTL, default 6h). A new session gets its stored DB row only on its first message; until then it is absent from `session.list` and cannot be resumed.
- `session.resume` takes a STORED id and returns a NEW live sid plus the full transcript in the RPC result — history is never replayed as events. Adopt `result.resumed` as the canonical stored id (compression chains rotate ids). `session.branch` requires a LIVE sid.
- Every event frame carries `session_id`; the hook drops events that do not match the current live sid.

Vite config proxies `/api` to the gateway (with WS), but the client currently connects directly to the gateway host/port; the proxy is only for a future same-origin setup.

## Intentionally out of scope (see README)

Session list/resume/branch, slash command palette, attachments, multi-session tabs, theming. Do not add these unless asked.
