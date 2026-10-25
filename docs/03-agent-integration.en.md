# Kinelayer · AI agent integration guide

> For anyone who wants a machine to edit the poster: Claude Desktop, Cursor, Codex CLI, your own script,
> or an AI assistant inside the browser. After reading this you should know **which ways in exist, how each
> one starts, what it can change, and what it cannot reach**.
>
> Protocol details, the command list and error codes are not hand-written — they come from the command
> registry in `src/core/registry.ts` and the protocol constants in `agent-bridge/src/bridge.js`. So this
> document ages with the code; when they disagree, the live prompt under **Settings → Desktop agent** wins.
>
> 中文版：[03-agent-integration.md](./03-agent-integration.md)

---

## 0. Pick a path in one minute

| Way in | Who it suits | Startup cost | Capability |
| --- | --- | --- | --- |
| **A. MCP (stdio)** | Claude Desktop / Cursor / Codex CLI — anything MCP-aware | one JSON config file | all commands, tools auto-generated |
| **B. HTTP** | your own scripts, CI, automation | a single `curl` proves it | all commands, request/response |
| **C. WebSocket** | long-lived links that want project updates | one WS client | all commands + manifest pushes |
| **D. In-browser AI** | people who just want to type a sentence on the page | a Base URL + key | the model picks commands via function calling |

All four drive **the same command bus**. There is no shortcut around it, and there is no second tool definition.

---

## 1. Prerequisite: start the bridge

The editor (Host) runs in the browser, and browsers cannot listen on a port — so a local relay sits in between:

```bash
# terminal 1: the bridge relay (127.0.0.1:2718 by default)
npm run bridge
# first run generates a token into agent-bridge/.token and prints it
```

Then in the page: **Settings → Agent bridge** → enter `ws://127.0.0.1:2718` plus the same token → connect.
You are in when the panel says `Bridge connected`.

> The bridge binds to `127.0.0.1` only — nothing on the LAN or the internet. It makes no business decisions,
> it only forwards.

Three ways to present the token (pick one):

| Context | Form |
| --- | --- |
| HTTP header | `x-kinelayer-token: <token>` (the legacy `x-ml-token` still works) |
| Query string | `?token=<token>` |
| WS connect | `ws://127.0.0.1:2718/?role=agent&token=<token>` |

Token precedence: `--token` argument > `KINELAYER_BRIDGE_TOKEN` env var > `agent-bridge/.token` > generated.

---

## 2. Way A: MCP (recommended for desktop clients)

```bash
npm run mcp   # stdio; the client launches it, no need to keep it running yourself
```

Sample config (Claude Desktop's `claude_desktop_config.json`; Cursor is analogous):

```json
{
  "mcpServers": {
    "kinelayer": {
      "command": "node",
      "args": ["<absolute path to repo>/agent-bridge/src/mcp.js"],
      "env": {
        "KINELAYER_BRIDGE_URL": "ws://127.0.0.1:2718/ws",
        "KINELAYER_BRIDGE_TOKEN": "<token printed by npm run bridge>"
      }
    }
  }
}
```

After editing the config, **fully quit** the client (closing the window is not enough) and reopen it.

What MCP exposes:

- **Tools**: one per command, named by replacing `.` with `__` in the command type — `layer.create` → `layer__create`.
  Arguments are that command's `payload`; the schema is generated from the registry.
- **Resources**: `kinelayer://project` (canvas, duration, layer ids/types/text) and `kinelayer://registry`
  (the full command catalogue).
- The tool list tracks the editor version. Clients just refresh; no config change needed.

---

## 3. Way B: plain HTTP

Health check, no token needed:

```bash
curl -s http://127.0.0.1:2718/health
```

| Purpose | Request |
| --- | --- |
| Read manifest | `GET /manifest` with `x-kinelayer-token: <token>` |
| Run a command | `POST /command`, body `{"type":"layer.update","payload":{…},"dryRun":false,"expectedVersion":12}` |

```bash
# read the project summary
curl -s -X POST http://127.0.0.1:2718/command \
  -H "content-type: application/json" -H "x-kinelayer-token: $TOKEN" \
  -d '{"type":"query.project","payload":{}}'

# dry-run first, then commit
curl -s -X POST http://127.0.0.1:2718/command \
  -H "content-type: application/json" -H "x-kinelayer-token: $TOKEN" \
  -d '{"type":"layer.update","payload":{"id":"ly_xxx","patch":{"x":120}},"dryRun":true}'
```

Every response is a `CommandResult`:

```json
{ "ok": true, "commandId": "cmd_…", "type": "layer.update", "data": {…},
  "projectVersion": 13, "durationMs": 3, "dryRun": false }
```

---

## 4. Way C: WebSocket

For cases that want a persistent link and pushed updates.

```text
→ {"kind":"call","id":"1","type":"layer.update","payload":{…},"dryRun":true}
← {"kind":"call.result","id":"1","result":{ok,data,error,projectVersion,commandId,durationMs}}

→ {"kind":"manifest.get","id":"2"}
← {"kind":"manifest","id":"2",tools:[…],summary:{…},projectVersion,playhead}
```

Request/response, you own the `id`s. Do not fire concurrently — the bus is a serial queue.

---

## 5. Way D: in-browser AI (built into the site)

No bridge, no MCP: fill in **Settings → AI channel** with an OpenAI-compatible endpoint.

| Field | Notes |
| --- | --- |
| Base URL | any OpenAI-compatible `/v1` (OpenAI / DeepSeek / Moonshot / local vLLM) |
| Model | must support function calling |
| API Key | encrypted with WebCrypto AES-GCM into IndexedDB; **never** appears in any command result |

Tool definitions again come from the registry (`buildToolSchemas()`); the context carries only a project
summary, never base64. Without a key the editor falls back to **demo mode** (local rule matching) that
understands things like "add a title", "export PNG", "change the background".

---

## 6. What it can do

By category (counts move with releases — trust the panel and `/manifest`):

| Category | Typical commands |
| --- | --- |
| Project | `project.new` `project.load` `project.rename` `project.create` `project.open` `project.duplicate` `project.listRecent` `project.deleteLocal` (dangerous, needs confirm) |
| Layer | `layer.create` `layer.update` `layer.delete` `layer.duplicate` `layer.reorder` |
| Text | `text.set` `text.setStyle` |
| Animation | `animation.setKeyframe` `animation.applyPreset` `animation.setEasing` … |
| Timeline | `timeline.seek` `timeline.setRange` `timeline.setZoom` |
| Background / canvas | `background.set` `canvas.resize` `canvas.setDuration` |
| Assets / fonts | `asset.import` `asset.place` `font.upload` |
| Query | `query.project` `query.layer` `query.registry` `query.capture` |
| Export | `export.png` `export.webm` `export.json` |
| System | `command.batch` `history.undo` `history.redo` `audit.list` |

---

## 7. Contract (seven rules — breaking them hurts)

1. **Read before you write**: ids must come from `query.project` / `manifest.summary`; never invent them.
2. **Collapse multi-step edits**: two or more changes go into one `command.batch` (`atomic:true`) so the user
   can undo them all at once.
3. **Dry-run when unsure**: `dryRun:true` validates without persisting and without an undo entry.
4. **Lock concurrent writes**: send `expectedVersion` (from the previous `projectVersion`). On `CONFLICT`,
   re-read and retry — do not hammer.
5. **Send serially**: the bus is a serial queue.
6. **Times are milliseconds**; keyframe times are relative to the layer's `inPoint`, not absolute.
7. **Re-sending is not retrying**: a duplicate write adds an undo entry. Judge success by `ok` and `projectVersion`.

---

## 8. Permission boundaries

**Allowed**: read the manifest and project summary, change layers/text/background/timeline/keyframes,
trigger exports (through the browser download flow).

**Out of reach — and out of bounds**:

| Boundary | Reality |
| --- | --- |
| Network | the bridge binds to `127.0.0.1`; you cannot reach other sites through it |
| Secrets | the API key is encrypted in IndexedDB and never appears in a command result |
| Binaries | images/videos/fonts live in IndexedDB; commands carry an `assetId` only |
| Filesystem | no command reads or writes local files; exports cannot choose a path |
| Approvals | dangerous commands must be confirmed by the user in the UI |
| Bypassing validation | do not use `project.load` to overwrite everything and skip schema checks |
| Touching the host | do not modify DOM / localStorage / IndexedDB; `window.__kly` exists only in dev builds |

---

## 9. Error codes

| code | Meaning | What to do |
| --- | --- | --- |
| `VALIDATION` | payload failed the schema | fix the field; do not resend the same body |
| `NOT_FOUND` | layer/asset id does not exist | re-read via `query.project` |
| `CONFLICT` | optimistic-lock version mismatch | re-read `projectVersion`, then retry |
| `FORBIDDEN` | blocked by a rule (deleting the background, editing a locked layer) | change approach |
| `RUNTIME` | the host threw during execution | relay the message verbatim |
| `UNAUTHORIZED` | wrong token | use the token the bridge printed |
| `NO_HOST` | bridge is up, page is not connected | connect from Settings → Agent bridge |

---

## 10. Pre-flight and troubleshooting

```bash
# (1) is the bridge alive? (no token)
curl -s http://127.0.0.1:2718/health

# (2) is the token right? (a tools array means yes)
curl -s -H "x-kinelayer-token: $TOKEN" http://127.0.0.1:2718/manifest | head -c 200

# (3) has the page connected? (a layer count means yes)
curl -s -X POST http://127.0.0.1:2718/command \
  -H "content-type: application/json" -H "x-kinelayer-token: $TOKEN" \
  -d '{"type":"query.project","payload":{}}'
```

| Symptom | Cause | Fix |
| --- | --- | --- |
| Connection refused / ECONNREFUSED | bridge not running | `npm run bridge` |
| `401` | token mismatch | read `agent-bridge/.token` |
| `503 NO_HOST` | page not connected | click connect in the page |
| Empty tool list | client cached an old manifest | restart the client / refresh the MCP connection |
| Edits do nothing | you are talking to another tab | each page is its own Host — confirm which one is connected |

> Closing the tab means disconnect. Every write then returns `NO_HOST`; do not loop.

---

## 11. The prompt inside the site

**Settings → Desktop agent** holds a live-generated integration brief containing:

- the current site address (`location.origin` + directory — includes `/Kinelayer/` on project pages)
- full steps for both ways in, plus the `curl` pre-flight
- the whole command catalogue (by category, with argument signatures, dangerous ones flagged)
- the seven contract rules, seven boundaries, error handling and reporting guidance

It **follows the UI language** (Chinese / English), can be downloaded as `.md`, and its command section comes
straight from the registry — add a command and a line appears.

---

## 12. Housekeeping

- Protocol fields, error codes and counts: the code is the source of truth; this file explains it.
- Adding a way in? Update the table in section 0 and the cards in the panel.
- This file never contains real tokens or machine-specific paths beyond the examples.
