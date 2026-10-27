# Kinelayer

[简体中文](README.md) · **English**

![Platform](https://img.shields.io/badge/platform-Web%20%2F%20Browser-blue)
![Engine](https://img.shields.io/badge/engine-Canvas2D%20%2B%20WebGL-6666cc)
![React](https://img.shields.io/badge/react-18-61DAFB?logo=react\&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.6-3178C6?logo=typescript\&logoColor=white)
![Node](https://img.shields.io/badge/node-18%2B-339933?logo=node.js\&logoColor=white)
![Agent](https://img.shields.io/badge/agent-MCP%20%2B%20OpenAI%20tools-7C5CFF)
![License](https://img.shields.io/badge/license-MIT-green)
![Deploy](https://img.shields.io/github/actions/workflow/status/KNGLOKIKO/Kinelayer/pages.yml?label=deploy)
![Demo](https://img.shields.io/badge/demo-online-brightgreen)

**A programmable motion-poster workbench** — a pure front-end, offline-capable, command-driven editor for animated posters.

**Live demo**: <https://knglokiko.github.io/Kinelayer/> · **Source**: <https://github.com/KNGLOKIKO/Kinelayer>

This is not "drag boxes around and hope". It is one command bus that folds four very different
actors into the same act: the human clicking buttons, the AI embedded in the page, an external
agent over MCP, and the detached layer window. Every capability lives in one registry, and
whatever the actor, the bus receives the same structured `Command`.

```
npm install
npm run dev          # http://localhost:5273
```

![Kinelayer UI](docs/preview.png)

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
Kinelayer/
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
│  │  ├─ commands/*.ts         86 commands, one file per domain (layer/text/code/background/project/asset/font/timeline/animation/selection/history/window/export/query/AI/custom/audio/batch)
│  │  ├─ customCommands.ts     [v2.7] Macro logic, pure: placeholder substitution, param coercion, pre-save validation, forbidden commands, step expansion
│  │  ├─ bundle.ts             Project package (.kly): ZIP packing/unpacking, per-file sha256, five unzip gates
│  │  ├─ importPipeline.ts     [v2.5] Import pipeline, pure functions: sniff → inspect report → map to layers/tracks
│  │  ├─ aiScene.ts            [v2.5] `scene.ai.json`: the semantic projection agents read (seconds, no base64, code digest)
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
│  ├─ persist/                 IndexedDB assets and KV, local font registration, two generations of legacy-DB migration
│  ├─ windows/                 ★ Multi-window: protocol, host, client, mirror UI, per-layer timeline, detached entry
│  ├─ ai/                      ★ AI: OpenAI-compatible client, encrypted config, demo agent, bridge client
│  ├─ ui/                      Stage, timeline, inspector, layer panel, AI panel, dialogs
│  │  ├─ Launcher.tsx          Launcher: recent-project card grid + size presets + rename/duplicate/delete/import
│  │  ├─ layout.ts             Three responsive tiers (wide ≥1440 / mid ≥1080 / narrow), rAF-throttled
│  │  ├─ importFlow.ts         Import state machine: pick → inspect → report → confirm → write (then leave the overlay)
│  │  └─ ImportReportDialog.tsx Import report: format, editable score, layer counts, degradation notes, missing assets
│  ├─ app/services.ts          Injects "side-effect capabilities" into the command layer
│  ├─ EditorApp.tsx            Shell + tour + master clock + autosave + shortcuts + narrow-screen drawers
│  └─ main.tsx                 Register commands → inject services → route by URL to host or layer window
├─ agent-bridge/               ★ Local bridge (Node 18+, its own dependencies)
│  ├─ src/bridge.js            WS + HTTP relay (127.0.0.1:2718, token auth)
│  ├─ src/mcp.js               MCP stdio server: tools generated dynamically from the manifest
│  └─ test/e2e.mjs             16 end-to-end assertions (fake host + real MCP client)
├─ scripts/                    ★ End-to-end self-checks (headless Edge + CDP, dev server on 5273 required)
│  ├─ _cdp.mjs                 Shared harness: launch browser, connect CDP, waitFor/screenshot/new tab, reporter
│  ├─ v2-check.mjs             17 · keyframes and timeline
│  ├─ rename-check.mjs         21 · brand and format migration
│  ├─ multi-project-check.mjs  32 · multi-project, index, legacy single-project migration
│  ├─ agent-panel-check.mjs    16 · desktop-agent prompt panel
│  ├─ bundle-check.mjs         20 · .kly real download / real import / hostile package rejection
│  ├─ launcher-check.mjs       22 · launcher routing, new-project dialog, unit conversion, thumbnails, English mode
│  ├─ ai-check.mjs             34 · [v2.5a] import inspect, degradation mapping, scene.ai.json round trip
│  └─ remotion-check.mjs       37 · [v2.5b] Remotion static parse, remotion-component, kit export
└─ docs/
   ├─ 00-reference-notes.md    Reference-project extraction report (chapter 14)
   ├─ 01-known-limitations.md  Known limits and extension points
   ├─ 02-bundle-format.md      Project package format (.kly = ZIP) spec and hostile-input gates
   ├─ 03-agent-integration.md  Agent integration guide (Chinese + this English sibling, .en.md)
   └─ 04-code-video-integration.md  AI code video: Remotion static parsing and remotion-kit export
```

**Layering rules**: `ui/` may not mutate `project` directly; `render/` may not import `store`;
`core/commands/` may not import `ui/`. Side effects (export, opening windows, reading files) are
injected through `services.ts`.

---

## Commands at a glance (86)

| Category | Count | Representative commands |
| --- | --- | --- |
| Layer | 13 | `layer.create` `layer.update` `layer.delete` `layer.duplicate` `layer.reorder` `layer.align` `layer.rename` `layer.fixAll` `layer.setVisible` `layer.setLocked` `layer.setBlendMode` `layer.setAnimation` `layer.setBindings` |
| Text | 3 | `text.setContent` `text.setStyle` `text.fitBox` |
| Code | 4 | `code.setSource` `code.setEngine` `code.setParams` `code.resetRuntime` |
| Background | 2 | `background.set` `background.setCode` |
| Canvas | 3 | `canvas.resize` `canvas.setDuration` `canvas.setFps` |
| Project | 11 | `project.new` `project.load` `project.create` `project.open` `project.rename` `project.duplicate` `project.deleteLocal` `project.listRecent` `project.seedSample` `project.exportBundle` `project.importBundle` |
| Asset | 4 | `asset.import` `asset.place` `asset.assign` `asset.remove` |
| Font | 3 | `font.register` `font.load` `font.remove` |
| Timeline | 5 | `timeline.play` `timeline.pause` `timeline.seek` `timeline.setLayerTiming` `timeline.setLoop` |
| Animation v2 | 8 | `animation.setKeyframe` `animation.removeKeyframe` `animation.moveKeyframes` `animation.setEasing` `animation.setKeyframeValue` `animation.clearTrack` `animation.setAutoKeyframe` `animation.applyPreset` |
| Selection | 4 | `selection.set` `selection.toggle` `selection.add` `selection.clear` |
| History | 3 | `history.undo` `history.redo` `history.clear` |
| Window | 4 | `window.openLayer` `window.closeLayer` `window.focusLayer` `window.setMode` |
| Export | 4 | `export.png` `export.webm` `export.json` `export.commands` |
| Query | 4 | `query.project` `query.layer` `query.registry` `query.capture` |
| AI | 5 | `ai.inspectImport` `ai.importProject` `ai.exportProject` `ai.queryCodeLayer` `ai.exportRemotionKit` |
| Custom | 4 | `custom.list` `custom.define` `custom.remove` `custom.run` (macros: a sequence of existing commands plus params, stored in their own IndexedDB store) |
| Audio | 1 | `audio.set` (volume / mute / fades / procedural tone parameters) |
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

## v3 · Workbench: many projects, project packages, three screen tiers, per-layer timeline

Before v3 you could only have one project open, and closing the tab meant forgetting the old one.
v3 adds the workbench layer.

### Launcher (project library)

Press `Ctrl/Cmd + O`, or open `?view=launcher` directly. A card grid lists every project on this machine:
thumbnail, name, size, duration, layer count, last modified; the current project carries a "current" badge.
Hovering reveals rename, duplicate, export `.kly`, delete. The header offers **New** (portrait 1080×1440 /
square 1080×1080 / landscape 1920×1080) and **Import package**.

**No card action touches IndexedDB directly** — they all go through `project.rename` / `project.duplicate` /
`project.deleteLocal` / `project.create` / `project.open`. So what you do in the launcher is the same thing
the AI or an external agent does: same undo stack, same audit log, same dryRun semantics.

Deleting the current project detaches it first: autosave skips it from then on, otherwise the next timer
tick would write the deleted project straight back.

### Project package `.kly` = a real ZIP

`Ctrl/Cmd + S` exports a ZIP containing `manifest.json` + `project.json` + `assets/` (image and video
originals) + `fonts/` (uploaded fonts only), with a sha256 per file. Assets are no longer base64, so a
package genuinely carries the media — open it on another machine and the images are still there.

Reading assumes the package is hostile: entry count / single-file size / total size / compression ratio /
path traversal are all checked **before** inflating. Import mints a fresh id instead of overwriting a
same-named project; a missing font degrades to a system font, a missing asset is a hard error.
Full spec: [project package format](docs/02-bundle-format.md).

Old backups keep working: `looksLikeZip()` only looks at the first two bytes — `PK` goes to the package
reader, anything else goes to the legacy `project.load` (v1 JSON envelope and even older bare `Project` JSON).

### Three responsive tiers

| Tier | Width | Layout |
| --- | --- | --- |
| `wide` | ≥ 1440 | left 268 + stage + right 318, full text labels |
| `mid` | ≥ 1080 | panels narrow to 232 / 288, top-bar subtitle hidden |
| `narrow` | < 1080 | both panels become **drawers** (overlay, never squeezing the stage); a bottom pill toggles panels / timeline / inspector; icon-only top bar |

Thresholds live in `WIDE_MIN` / `MID_MIN` in `src/ui/layout.ts`; `useLayoutTier()` throttles `resize`
through rAF so dragging the window edge does not run a React render per event.

### Timeline inside the detached layer window

The layer window (`?layer=<id>`) used to show properties only. It now has its own timeline: everything
outside in/out is dimmed, each property track gets a thin line, keyframes are diamonds tinted per property,
the playhead is a red line, and you can jump to the previous/next keyframe.

It stays a **read-only mirror**: dragging emits `{ kind: 'command', command: 'timeline.seek' }` to the host,
and the host decides the landing point and broadcasts it back. Seeks are throttled to 80ms keeping the last
position, so scrubbing across the whole timeline produces a sparse stream instead of flooding the queue.

---

## v2.5 · AI code video: importing in, exporting semantics out (phase A)

The job of this phase is to let AI-generated projects come in and go out, under three rules:

1. **Code is a first-class layer.** Whatever cannot be mapped is not disguised as a picture: text/images/timing
   map to native layers and tracks, and things that still need drawing (rectangles, circles, paths) degrade into
   a canvas2d code layer — position/size/opacity stay keyframable, only the internals stop being element-editable.
2. **Inspect first, then write.** `ai.inspectImport` is a pure function: given bytes or text it answers
   "what will this import produce" — format, editable score, layer/code/track/keyframe counts, every degradation
   reason, missing assets. Only after the user confirms does `ai.importProject` write (it re-runs the same
   inspection internally, so an agent that skips step one still gets the report).
3. **Export carries a semantic layer.** `ai.exportProject` emits `scene.ai.json`: seconds instead of milliseconds,
   easing flattened to strings, code layers carrying `codeSummary` + `codeLines` + `codeBytes`, and **no base64**.

| Input | Result | Editable |
| --- | --- | --- |
| `.kly` package | goes through `project.importBundle` (sha256 verified) | 100 |
| native `project.json` | `normalizeProject` restores it exactly (detected by blendMode/animation/inPoint, not `layers[0].type`) | 100 |
| `scene.ai.json` | flattened back to scene shape, then the same pipeline | 96+ |
| scene JSON (Rendervid / cadence style) | text→text layer, media→media layer, box/timing→layer props, `tracks`→property tracks; rect/circle→canvas2d code layer | 70–96 |
| HTML / GSAP snippet | Static DOM parse: absolutely positioned text/images/containers become native layers, CSS class rules feed font size and colour, GSAP timelines become property tracks; elements in normal flow stay together as an `html` code layer | 20–95 |
| image / video | canvas + media layer | 30 |
| Remotion project ZIP | static AST parse: `<Sequence>` timing, text/image/container→native layers, `interpolate`/`spring`→property tracks; custom components stay whole as `remotion-component` code layers | 25–90 |

`scene.ai.json` round-trips: re-importing the semantic projection keeps layer count, text and keyframes;
media layers keep only the asset name because the export carries no binary, and the report says so instead of
letting users discover it themselves.

Remotion is stricter: **source is read, never executed**, and only structure is parsed (JSX elements, literals,
constant tables, `interpolate`/`spring` arguments). Data from `useContext`, `fetch` results and coordinates
computed in loops are never guessed — a wrong guess makes people believe they imported the original film.
Components that cannot be split stay whole, double-clicking opens a **read-only** source viewer, and the
timeline draws a static first-frame card. Details: [code video integration](docs/04-code-video-integration.md).

Every layer remembers where it came from — `LayerOrigin = { generator, sourceFormat, sourceBundle, importedAt }` —
which drives the `AI` / `Import` badge in the layer tree, the audit trail for degradation decisions, and the
answer to "why can't I edit inside this layer".

```
ai.inspectImport   { stageId | text, name?, format? }        → { report, importable }
ai.importProject   { stageId | text, mode? }                 → { projectId, format, fidelity, counts… }
ai.exportProject   { projectId?, includeCode?, download? }   → { filename, text, bytes, layers… }
ai.queryCodeLayer  { layerId?, includeCode? }                → code-layer digests (no full scene)
ai.exportRemotionKit { projectId?, download? }               → remotion-kit ZIP (renderable with npx remotion render)
```

### remotion-kit: take the code out to render

Kinelayer never runs a render pipeline in the browser, so `remotion-component` layers only preview statically.
`ai.exportRemotionKit` writes a standalone project you can render outside:

```
remotion-kit/
├── package.json      remotion / react / react-dom / @remotion/cli only
├── src/index.ts      registerRoot
├── src/Root.tsx      one <Composition> per Remotion layer
├── src/layers/<Name>/entry.tsx   that layer's component source (adds a default export if missing)
├── src/original/**   the original source tree (relative imports keep working)
├── public/assets/**  referenced media
└── README.md         the npx remotion render command
```

```bash
npm install && npx remotion render src/index.ts kly-01 out/kly-01.mp4
```

### HTML / GSAP: what stays behind is "the rest"

An `.html` file comes in and is split once, by absolute positioning: elements with
`position:absolute` **and** `left/top` become native layers; class rules in `<style>`
(font size, colour, radius) are read along; `gsap.to / from / fromTo / timeline` inside
`<script>` become native keyframes.

What cannot be split (normal flow, flex, canvas, svg) never gets a guessed position — it stays
together as one `html` code layer, and the report says "N elements in normal flow stay in the
code layer". The boundary is written up in
[docs/05-html-gsap-import.md](docs/05-html-gsap-import.md).

While editing, that `html` code layer is a `sandbox="allow-scripts"` iframe with a bridge
script injected: **it freezes its animations on load and seeks with the main timeline** instead of
running on wall-clock time. It also measures its own content bounds and reports them back —
a sandbox iframe's white background cannot be removed in Chrome (`html/body { background:
transparent }` fails too; four variants were tested), so the only way is to make its background
equal the canvas colour and shrink the iframe to the region that actually has content.

Once the import report is dismissed, an image that never made it into the project leaves a grey
placeholder and nothing else — so each such layer keeps `origin.sourceRef` (the address it
pointed at), the layer tree shows a "N layers missing assets" tally that selects them all, and
the Inspector's **Source** section attaches a replacement in place (geometry and keyframes
untouched) via `asset.assign`. Layers sharing one URL are filled together. Details in
[docs/06-after-import.md](docs/06-after-import.md).

---

## v2.9 · The tour film and the audio layer

Two requests that turned out to be one: **the first screen should explain the project, and it should not be silent.**

The sample project is now a **96-second tour film** (1920×1080 / 30fps / no loop), six 16-second chapters:
opening → background → core features → how to use it → what is inside → closing. Opening it is like watching
a product walkthrough, and the timeline doubles as a storyboard for how those chapters were built.

One rule holds the structure together: **a chapter is a group of layers sharing the same time span.**
To change a chapter, select that group; to drop one, delete the group — no orphan keyframes left behind.
Copy and graphics live in `CHAPTERS` / `POINTS` / `GRAPHICS`, so editing content never touches the timeline.

The sound is **computed**, not sampled: the project file only carries a few dozen bytes of `tone` parameters,
every machine hears exactly the same thing, and the "zero external assets" rule survives. Three presets —
`pad` for the bed, `pulse` for the beat, `chime` for chapter cues (trigger times live in `marks`).

Scheduling has three layers worth reading: an **anchor** (a single project-time ↔ `AudioContext` mapping;
the master clock re-anchors when it drifts past 400ms, which is how a seek is detected), **lookahead**
(wake every 200ms, schedule the next 1.2s up front), and a **worker ticker** (window timers get throttled
to once per second in background tabs, workers do not — the pattern is lifted from Tone.js's `Ticker`).

Export takes a different route: `OfflineAudioContext` renders the whole track first (fast and deterministic),
then the buffer plays into a `MediaStreamAudioDestinationNode` that is muxed into the WebM — the idea comes
from `Tone.Offline`. Timeline waveforms follow the wavesurfer.js peaks approach: render offline, bucket the
peaks, draw SVG lines.

Details in [docs/09-audio.md](docs/09-audio.md).

---

## Shortcuts

| Action | Keys |
| --- | --- |
| Undo / redo | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |
| Duplicate selection | `Ctrl/Cmd + D` |
| Open project library | `Ctrl/Cmd + O` |
| Export package `.kly` | `Ctrl/Cmd + S` |
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

**Rather not hand-write config?** Open **Settings → Desktop agent**. It carries an integration prompt generated live
from the command registry — site address, both ways in, the capability scope of all 75 commands, seven contract rules,
seven permission boundaries, error-code handling, plus three `curl` pre-flight checks. One click copies it for any
local agent tool, and a “Copy MCP config” button sits right next to it.

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
VITE_BASE=/Kinelayer/ npm run build   # project pages need this prefix
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

- **Project package `.kly`**: a real ZIP — `manifest.json` + `project.json` + `assets/` + `fonts/`, with a sha256 per file.
  Media rides along as raw bytes (no more base64, so no 33% bloat); open it on another machine and the images are still there.
  System fonts are not packaged (they are already there, and it avoids font-licensing questions). Spec: `docs/02-bundle-format.md`.
- **JSON backup**: Settings → Data → Export JSON backup writes the bare project as JSON with no binaries — good for diffing in git.
- **Lenient import**: `.kly`, the v1 JSON envelope, and even older bare `Project` JSON all import, so changing the format never orphaned a backup.
- **Autosave**: the project is written to IndexedDB (database `kinelayer`) every 1.6s and restored on reload.
- **No outbound traffic**: apart from the AI endpoint you configure yourself, the app makes no network requests. No CDN, no telemetry, no remote fonts.
- **Renames keep your data**: the rebrand renamed the database and storage keys, so on first launch the old database is **copied wholesale** into the new one and left untouched (never deleted). Old-namespace localStorage keys migrate on read, and bare project JSON backups still import.

---

## Docs

- [Reference-project extraction report](docs/00-reference-notes.md) — chapter 14, item by item: what was borrowed, what was deliberately not ported, where the differences are
- [Known limitations and extension points](docs/01-known-limitations.md) — export formats, sandbox boundaries, multi-window fallback chain, performance ledger
- [Project package format](docs/02-bundle-format.md) — `.kly` ZIP layout, manifest fields, the five hostile-input gates, error codes
- [Code video integration](docs/04-code-video-integration.md) — how far Remotion parsing goes, the `remotion-component` boundary, rendering a remotion-kit
- [After import](docs/06-after-import.md) — the four states of a media layer, why `sourceRef` only records what was never fetched, fixing layers that share one address
- [Custom commands](docs/07-custom-commands.md) — why there is no DSL, the two meanings of `{{x}}`, why one macro must be one atomic batch, forbidden commands
- [First run](docs/08-first-run.md) — the six chapters of the 96-second tour, why frame 0 must not carry an enter animation, the four beats of the intro animation
- [Audio layer](docs/09-audio.md) — why the tones are synthesised, anchor + lookahead + worker scheduling, offline-rendered export, waveforms

## License

MIT, see [LICENSE](LICENSE). The design and naming of the reference projects belong to their
original authors (see `docs/00-reference-notes.md`); this project borrows ideas, not code.
