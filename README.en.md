# MotionLayer

[简体中文](README.md) · **English**

![Platform](https://img.shields.io/badge/platform-Web%20%2F%20Browser-blue)
![Engine](https://img.shields.io/badge/engine-Canvas2D%20%2B%20WebGL-6666cc)
![React](https://img.shields.io/badge/react-18-61DAFB?logo=react\&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.6-3178C6?logo=typescript\&logoColor=white)
![Node](https://img.shields.io/badge/node-18%2B-339933?logo=node.js\&logoColor=white)
![Agent](https://img.shields.io/badge/agent-MCP%20%2B%20OpenAI%20tools-7C5CFF)
![License](https://img.shields.io/badge/license-MIT-green)
![Deploy](https://img.shields.io/github/actions/workflow/status/KNGLOKIKO/MotionLayer/pages.yml?label=deploy)
![Demo](https://img.shields.io/badge/demo-online-brightgreen)

**A programmable motion-poster workbench** — a pure front-end, offline-capable, command-driven editor for animated posters.

**Live demo**: <https://knglokiko.github.io/MotionLayer/> · **Source**: <https://github.com/KNGLOKIKO/MotionLayer>

This is not "drag boxes around and hope". It is one command bus that folds four very different
actors into the same act: the human clicking buttons, the AI embedded in the page, an external
agent over MCP, and the detached layer window. Every capability lives in one registry, and
whatever the actor, the bus receives the same structured `Command`.

```
npm install
npm run dev          # http://localhost:5273
```

![MotionLayer UI](docs/preview.png)

---

## The five hard rules, and where they live

| # | Rule | Code | How to check |
| - | --- | --- | --- |
| 1 | Every change is one `Command` on one bus | `src/core/commandBus.ts`, `src/core/registry.ts` | Settings → command panel: type a payload by hand and run it; the audit panel shows the origin (user / ai / agent / window) |
| 2 | The host window is the only authority: one executor, one undo stack, one master clock | `EditorApp.tsx` (rAF clock), `temporal.ts`, `commandBus.ts` | Open a layer window — the undo button exists only in the host |
| 3 | Layer windows are read-only mirrors: send requests, wait for broadcasts | `src/windows/client.ts`, `LayerMirror.tsx` | Close the host and the mirror immediately reports "disconnected" |
| 4 | Preview and export share one geometry and one renderer | `renderScene.ts` + `geometry.ts`, reused by `exporters.ts` and the mirror | Export the same frame as PNG and compare pixels with the screen |
| 5 | Tool schemas are generated from the command registry | `registry.ts#buildToolSchemas` → `ai/client.ts` (OpenAI), `agent-bridge/src/mcp.js` (MCP) | Add a command, reload, and both the AI and MCP tool lists grow by one |

---

## Layout and module responsibilities

```
MotionLayer/
├─ index.html                  Boot-time fatal-error fallback (plain words even if the bundle dies)
├─ src/
│  ├─ core/                    ★ The single source of truth: data, commands, history
│  │  ├─ types.ts              Model: Project / 5 layer kinds / animation / bindings / assets
│  │  ├─ schemas.ts            Shared zod fragments: colour, easing, layer patch, animation…
│  │  ├─ registry.ts           Command registry + tool-schema generation (OpenAI / MCP share it)
│  │  ├─ commandBus.ts         Pipeline: validate → optimistic lock → dryRun → immer → undo point → broadcast → audit
│  │  ├─ temporal.ts           Hand-rolled undo: immer patches / inverse patches / 700ms coalescing
│  │  ├─ store.ts              Zustand in three slices: project (persisted) / ui / runtime (never persisted)
│  │  ├─ defaults.ts           Factories + normalizeProject (lenient read, strict write) + demo project
│  │  ├─ commands/*.ts         67 commands, one file per domain (layer/text/code/background/project/asset/font/timeline/animation/selection/history/window/export/query/batch)
│  │  └─ summary.ts            Project summary for the AI (no base64, code truncated)
│  ├─ render/                  ★ Rendering: pure functions, unaware that React exists
│  │  ├─ renderScene.ts        The single render entry: preview / PNG / WebM / mirror all go through it
│  │  ├─ geometry.ts           Coordinates, hit testing, fitViewport, snapping
│  │  ├─ animation.ts          Expression compilation, noise, preset sampling, three-slot composition + track override
│  │  ├─ keyframes.ts          [v2] Keyframe evaluation: evaluateTrack / applyTracks / cubic-bezier
│  │  ├─ text.ts               Manual line breaking (per-char for CJK, per-word for Latin), gradient text, tracking
│  │  ├─ codeEngine.ts         canvas2d / glsl / html engines + sandbox + circuit breaker + signal bus
│  │  ├─ assets.ts             Image/video pool (IndexedDB → ImageBitmap / VideoElement)
│  │  ├─ htmlRaster.ts         HTML layer export: SVG foreignObject rasterization
│  │  └─ exporters.ts          PNG / WebM (manual frame push) / JSON
│  ├─ persist/                 IndexedDB assets and KV, local font registration
│  ├─ windows/                 ★ Multi-window: protocol, host, client, mirror UI, detached entry
│  ├─ ai/                      ★ AI: OpenAI-compatible client, encrypted config, demo agent, bridge client
│  ├─ ui/                      Stage, timeline, inspector, layer panel, AI panel, dialogs
│  ├─ app/services.ts          Injects "side-effect capabilities" into the command layer
│  ├─ EditorApp.tsx            Three-column shell + tour + master clock + autosave + shortcuts
│  └─ main.tsx                 Register commands → inject services → route by URL to host or layer window
├─ agent-bridge/               ★ Local bridge (Node 18+, its own dependencies)
│  ├─ src/bridge.js            WS + HTTP relay (127.0.0.1:2718, token auth)
│  ├─ src/mcp.js               MCP stdio server: tools generated dynamically from the manifest
│  └─ test/e2e.mjs             16 end-to-end assertions (fake host + real MCP client)
└─ docs/
   ├─ 00-reference-notes.md    Reference-project extraction report (chapter 14)
   └─ 01-known-limitations.md  Known limits and extension points
```

**Layering rules**: `ui/` may not mutate `project` directly; `render/` may not import `store`;
`core/commands/` may not import `ui/`. Side effects (export, opening windows, reading files) are
injected through `services.ts`.

---

## Commands at a glance (67)

| Category | Count | Representative commands |
| --- | --- | --- |
| Layer | 13 | `layer.create` `layer.update` `layer.delete` `layer.duplicate` `layer.reorder` `layer.align` `layer.rename` `layer.fixAll` `layer.setVisible` `layer.setLocked` `layer.setBlendMode` `layer.setAnimation` `layer.setBindings` |
| Text | 3 | `text.setContent` `text.setStyle` `text.fitBox` |
| Code | 4 | `code.setSource` `code.setEngine` `code.setParams` `code.resetRuntime` |
| Background | 2 | `background.set` `background.setCode` |
| Canvas | 3 | `canvas.resize` `canvas.setDuration` `canvas.setFps` |
| Project | 3 | `project.load` `project.new` `project.rename` |
| Asset | 3 | `asset.import` `asset.place` `asset.remove` |
| Font | 3 | `font.register` `font.load` `font.remove` |
| Timeline | 5 | `timeline.play` `timeline.pause` `timeline.seek` `timeline.setLayerTiming` `timeline.setLoop` |
| Animation v2 | 8 | `animation.setKeyframe` `animation.removeKeyframe` `animation.moveKeyframes` `animation.setEasing` `animation.setKeyframeValue` `animation.clearTrack` `animation.setAutoKeyframe` `animation.applyPreset` |
| Selection | 4 | `selection.set` `selection.toggle` `selection.add` `selection.clear` |
| History | 3 | `history.undo` `history.redo` `history.clear` |
| Window | 4 | `window.openLayer` `window.closeLayer` `window.focusLayer` `window.setMode` |
| Export | 4 | `export.png` `export.webm` `export.json` `export.commands` |
| Query | 4 | `query.project` `query.layer` `query.registry` `query.capture` |
| Batch | 1 | `command.batch` (many commands collapsed into one undo point, atomic rollback on failure) |

Every command carries a zod schema, a description, a runnable `example`, and metadata such as
`mutating / dangerous / undoable / coalesce / asyncHandler / resetsHistory`.

---

## v2 · Keyframes

v1 had three preset slots (enter / exit / emphasis) — enough for a stiff fade, not enough for real motion.
v2 adds **property tracks** on top, and demotes the presets to one-click sugar: what they generate are
ordinary tracks, and there is no second animation runtime.

| Concept | Notes |
| --- | --- |
| `AnimatableProperty` | `x` `y` `width` `height` `rotation` `opacity` `fontSize` `letterSpacing`. One admission rule: the value must be uniquely derivable from `(keyframes, localTime)` |
| `Keyframe.time` | **Milliseconds relative to the layer's `inPoint`** — never an absolute time. Move the layer and every keyframe follows |
| `EasingSpec` | Any existing easing name, or a `cubic-bezier` curve (same meaning as CSS; solved with Newton iterations plus a bisection fallback) |
| Evaluation order | base properties → preset slots (whole-span decoration) → **tracks (absolute, they win)** → expression bindings |
| Auto-keyframe | With it on, changing a property that **already has a track** drops a keyframe at the playhead. Implemented in the command layer, so humans, the AI and agents behave identically |

In the timeline: `A` on each layer row toggles auto-keyframe, the diamond button opens the preset menu.
Expand a layer with the chevron to see its property tracks; the diamond on a track adds a keyframe at the
playhead, dragging a diamond shifts the selection (committed on release — one drag, one undo entry), and
`Shift`-click multi-selects so you can change easing or delete as a group. Layers pushed outside the
duration are highlighted in red, and the "N layers out of range · fix" button pulls them back in one go.

Project files carry `schemaVersion` (currently 2). v1 files are migrated by `normalizeAnimation` on read,
and always written back at the current version — lenient read, strict write.

---

## Shortcuts

| Action | Keys |
| --- | --- |
| Undo / redo | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |
| Duplicate selection | `Ctrl/Cmd + D` |
| Export JSON | `Ctrl/Cmd + S` |
| Play / pause | `Space` |
| Delete selection | `Delete` / `Backspace` |
| Clear selection | `Esc` |
| Fit canvas | `Shift + !` |
| Nudge 1px / 10px | arrow keys / `Shift + arrows` |
| Pan canvas | middle-drag or `Space + drag` |
| Zoom canvas | `Ctrl/Cmd + wheel` |
| Edit text in place | double-click a text layer |

---

## Wiring up AI (two channels)

### Channel A: AI inside the page

Top-right **AI** → Settings → fill in Base URL / model / API key (any OpenAI-compatible endpoint).
**It works without a key**: the app falls back to an offline demo agent that turns your sentence
into commands with local rules, exercising the full plan → review → execute loop so you can see
the shape of it first.

Safety design:

- The key is encrypted with WebCrypto AES-GCM and kept in IndexedDB — never in localStorage, never in the project file;
- Dangerous commands (delete, clear, load project) raise an approval card and do not run by default;
- Every AI-generated command becomes its own card in the conversation and can be undone individually.

### Channel B: an external agent (MCP)

```bash
# Terminal 1: the bridge (prints a token; generated into agent-bridge/.token on first run)
npm run bridge

# Terminal 2: the MCP server (stdio, for Claude Desktop / Cursor)
npm run mcp
```

Then open **Settings → Agent bridge** in the editor, enter `ws://127.0.0.1:2718` plus the token and
hit connect. The status bar shows "Agent connected" when it is up.

A Claude Desktop config sample lives in `agent-bridge/claude-desktop-config.json`.

Self-check (no browser needed):

```bash
cd agent-bridge && npm test
```

---

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` is already in place: push to `main` and it builds and publishes.

```bash
# One-time: repo Settings → Pages → Source = "GitHub Actions"
# The workflow injects the asset prefix at build time
VITE_BASE=/MotionLayer/ npm run build   # project pages need this prefix
```

- The site lives at `https://<user>.github.io/<repo>/`; rename the repo and you must update `VITE_BASE` in the workflow.
- Pages on free accounts requires a **public** repository.
- For a custom domain: set it in Pages settings, then switch `VITE_BASE` back to `/`.

## The built-in "AI integration prompt"

Top-right **Integrate** (there is also a plug icon in the AI panel header) opens the prompt panel,
which copies or downloads three flavours in one click:

| Flavour | For | How |
| --- | --- | --- |
| Any LLM | Any chat window (ChatGPT / DeepSeek / a local model) | Copy the prompt → the model replies with JSON → paste it back into "Execute" and the app collapses it into **one undo point** |
| MCP client | Claude Desktop / Cursor | Run `npm run bridge` + `npm run mcp` first, then the model calls tools itself |
| Function calling | Your own agent | Copy the `tools` array into the request body |

The command list and every parameter enum (preset / easing / text-style fields) inside the prompt
are generated from the registry and the zod schemas — **not hand-written docs**. Add a command and
all three flavours grow at once.

## Data and privacy

- **Project files**: `export.json` writes plain JSON with **no image/video base64** (assets stay in IndexedDB).
  Moving machines means re-importing media — that is deliberate, so a project file never balloons into tens of megabytes.
- **Autosave**: the project is written to IndexedDB (database `motionlayer`) every 1.6s and restored on reload.
- **No outbound traffic**: apart from the AI endpoint you configure yourself, the app makes no network requests. No CDN, no telemetry, no remote fonts.

---

## Docs

- [Reference-project extraction report](docs/00-reference-notes.md) — chapter 14, item by item: what was borrowed, what was deliberately not ported, where the differences are
- [Known limitations and extension points](docs/01-known-limitations.md) — export formats, sandbox boundaries, multi-window fallback chain, performance ledger

## License

MIT, see [LICENSE](LICENSE). The design and naming of the reference projects belong to their
original authors (see `docs/00-reference-notes.md`); this project borrows ideas, not code.
