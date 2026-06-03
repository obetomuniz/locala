# A2UI (experimental)

Generative UI for the on-device agent: declarative surfaces streamed as
[A2UI v0.8](https://a2ui.org/specification/v0_8/) server messages, carried on
`a2ui_message` **AgentEvent**s (not AG-UI / CopilotKit).

Enable with `createAgent({ a2ui: { enabled: true } })`. Demo preset and renderer:
`#experimental/agent` → **Generative UI (A2UI)**.

## Terms (30-second version)

| Term | Meaning |
|------|---------|
| **JSONL** | One JSON object per line; each line is one server message (`surfaceUpdate`, `beginRendering`, …). |
| **A2UI v0.8** | Protocol for UI patches (component tree + optional data model), not HTML/React source. |
| **Catalog** | Allowed component types (`Text`, `Button`, `Card`, …). See [standard catalog](https://a2ui.org/specification/v0_8/standard_catalog_definition.json). |
| **Transport** | How messages are delivered. Here: in-process `AgentEvent`, not a separate AG-UI wire. |

## How UI is produced (three paths)

| Path | When | Notes |
|------|------|--------|
| **Synthesize** | UI-intent turn on weak on-device models | Model returns small playground JSON (`title`, `metrics`, …); `synthesize.ts` emits valid v0.8 messages. |
| **Native JSONL** | Model streams proper `{"surfaceUpdate":…}` lines | `parse.ts` / `repair.ts`; best spec fidelity when the model cooperates. |
| **Static demos** | Dashed chips in the playground | `demos.ts` + `previewA2ui()`; no model call. |

Plain Q&A (e.g. time in a timezone) stays markdown + tools (`clock_now` on the A2UI preset).

## Spec vs this prototype

| Area | Status |
|------|--------|
| Server message types (`surfaceUpdate`, `dataModelUpdate`, `beginRendering`, `deleteSurface`) | Implemented in `types.ts` / `parse.ts` / `store.ts` |
| `AgentEvent` transport | Yes (`a2ui_message`) |
| Full catalog renderer | No — subset in `playground/a2ui/A2uiView.tsx` |
| Playground-only components | `Chart`, `StatRow` (from synthesizer only) |
| `dataModelUpdate` bindings in the view | Stored, not bound in React yet |
| Button / field actions back to the agent | Not yet |

`store.ts` may mark a surface ready when a `root` component appears even if the model skips `beginRendering` (on-device reliability).

## Module map

| File | Role |
|------|------|
| `types.ts` | v0.8 message + snapshot types |
| `parse.ts` / `jsonl.ts` / `extract.ts` | Line parsing and stream buffering |
| `repair.ts` | Tolerant parse + playground JSON fallback |
| `constraint.ts` / `synthesize.ts` | Playground JSON schema → v0.8 messages |
| `intent.ts` | UI vs prose turn detection; tool whitelist for constraints |
| `store.ts` | `applyA2uiMessage` reducer |
| `demos.ts` | Static playground surfaces |
| `prompt.ts` | System-prompt appendix |
| `loop.ts` | Wires constraint + `a2ui_message` emission |

## Likely next steps

- Golden tests per path (JSONL, synthesize, static).
- Load standard catalog JSON for dev-time validation.
- Bind `dataModelUpdate` in `A2uiView`.
- Client → server actions when interactive UI is required.

Upstream spec changes (v0.9+): update `A2UI_SERVER_MESSAGE_KEYS` and the parse switch first.
