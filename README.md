# hermes-web-ui

Minimal **React** client for Hermes Agent. Talks the real **TUI gateway JSON-RPC** protocol over WebSocket (`/api/ws`) — same path desktop/dashboard use — not a fake OpenAI chat wrapper.

## What this spike covers

- Connect to a Hermes gateway with a loopback session token
- `session.create`
- `prompt.submit` + stream `message.delta` / `message.complete`
- Tool timeline (`tool.start` / `tool.progress` / `tool.complete`)
- `approval.request` → `approval.respond`
- `clarify.request` → `clarify.respond`
- `session.interrupt`
- `session.list` / `session.resume` / `session.branch` — session sidebar with resume and branch

## Quick start

Gateway must already be running (`hermes serve` or `hermes dashboard`). This app does not start it.

```bash
cp .env.example .env.local
# Prefer a stable token: start the gateway with HERMES_DASHBOARD_SESSION_TOKEN set,
# then put the same value in VITE_HERMES_TOKEN. Otherwise scrape the live token:
python3 -c "import re,urllib.request; print(re.search(r'__HERMES_SESSION_TOKEN__=\"([^\"]+)\"', urllib.request.urlopen('http://127.0.0.1:9119/').read().decode()).group(1))"
# paste into VITE_HERMES_TOKEN in .env.local, then:
npm install
npm run smoke   # WS connect + session.create against the running gateway
npm run dev     # binds 127.0.0.1:5173 (strictPort)
```

Vite only reads `.env.local` at process start — restart `npm run dev` after changing the token. Open `http://127.0.0.1:5173/`, confirm token, click **Connect**, send a message.

If the dev terminal ignores Ctrl+C (echoes `^C` instead of exiting), kill from another shell:
`lsof -tiTCP:5173 -sTCP:LISTEN | xargs kill`

### Why Connect fails with 403/Unauthorized

Loopback auth is a single session token minted when the gateway process starts (`HERMES_DASHBOARD_SESSION_TOKEN` or a random `token_urlsafe(32)`). The official dashboard injects it as `window.__HERMES_SESSION_TOKEN__`. A hardcoded placeholder in `.env.local` will not match a long-lived `hermes dashboard` and the WS upgrade returns **403**.

## Protocol notes

| Piece | Detail |
|---|---|
| Transport | `ws://HOST:PORT/api/ws?token=TOKEN` |
| Auth (loopback) | Same ephemeral/session token as dashboard REST/WS (`?token=…`) |
| Origin | Browser origin must be loopback (`localhost` / `127.0.0.1`) when Hermes is bound to loopback |
| RPC client | Vendored wire-compatible `JsonRpcGatewayClient` in `src/lib/json-rpc-gateway.ts` |
| Docs | Hermes `developer-guide/programmatic-integration` → TUI gateway |

`prompt.submit` is fire-and-forget for completion: the RPC ack is not the final answer. UI completion comes from stream events.

## Project layout

```
src/
  lib/json-rpc-gateway.ts   # WS JSON-RPC client
  lib/types.ts              # connection + event payloads
  hooks/useHermesChat.ts    # session + stream state machine
  App.tsx                   # thin UI shell
```

## Next builds (intentionally not here)

- Slash command palette (`commands.catalog` + `command.dispatch`)
- File/image attach
- Multi-session tabs
- Design system polish / theming

Keep the gateway client as the source of truth; grow UI around events, not around REST chat completions.
