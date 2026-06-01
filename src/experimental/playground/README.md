# Agent Playground design decisions

This document captures decisions made in the `#experimental/agent`
playground that are intended to carry into `web-ai-kit`.

Scope: transcript rendering, tool-call rendering, startup/streaming UX,
and separation of engine vs UI integration.

## Goals

- Keep the **agent engine native and deterministic**.
- Keep the UI **pluggable by design** for markdown/tool rendering.
- Allow external integrations (for example Streamdown) without coupling
  the core loop to a specific renderer library.
- Make package lift straightforward.

## Decision 1: Keep native streaming in the engine

The run loop remains on top of `@web-ai-sdk/prompt` streaming semantics.
UI changes do not change the execution protocol.

- Engine path: `src/experimental/agent/loop.ts`
- React adapter: `src/experimental/agent/react/useAgent.ts`

Why:

- We need execution behavior and renderer behavior to evolve separately.
- UI regressions should not affect run correctness or tool orchestration.

## Decision 2: Prewarm session clones to reduce start latency

The loop now keeps a prefetched clone ready for the next run.

- Claimed at run start via `takeRunSession()`
- Re-prefetched after run completion
- Invalidated on `newSession()`/`destroy()`

Why:

- Avoid waiting on clone acquisition at send-time.
- Improve request start responsiveness into millisecond range.

## Decision 3: Pluggable transcript renderer registry

Transcript text rendering is selected by id from a small registry.

- Registry: `src/experimental/playground/transcriptRenderers.tsx`
- Preset selection key: `transcriptRendererId`
- Presets: `src/experimental/playground/presets.ts`

Current renderers:

- `react-markdown` (default)
- `streamdown` (external integration)

Why:

- New renderer integrations should be additive, not invasive.
- Presets can demonstrate behavior without changing engine code.

## Decision 4: Pluggable tool-call renderer registry

Tool-call cards are also selected by id from a registry.

- Registry: `src/experimental/playground/toolRenderers.tsx`
- Preset selection key: `toolRendererId`
- Wiring: `src/experimental/playground/Transcript.tsx`

Current tool renderers:

- `default` (current detailed cards)
- `minimal` (compact status/output trail)

Why:

- Tool-call visualization is presentation, not protocol.
- Different hosts may want very different verbosity/shape.

## Decision 5: External renderer integration should be opt-in per preset

External renderers are enabled in dedicated presets instead of becoming
the global default.

Current preset:

- `platform-streamdown` ("Platform + Streamdown")

Why:

- Keeps baseline behavior stable.
- Makes side-by-side comparison easy.
- Reduces risk when testing new libraries.

## Decision 6: Streaming smoothness over token-level reflow

UI updates are batched per frame and rendered in a lighter streaming path.

- Batched `text_delta` projection: `useAgent.ts`
- Streaming markdown rendering strategy: `MessageContent.tsx`

Why:

- Avoid one React render per token on fast streams.
- Reduce perceived stutter without changing run semantics.

## Decision 7: `returnDirect` tool fast-path

Tools may opt into returning their output directly as the final response,
skipping the extra post-tool model synthesis turn.

- Tool metadata: `AgentTool.returnDirect`
- Loop routing: `resolveDirectReturnText()` in `agent/loop.ts`
- Current opt-in tool: `summarize_text`

Why:

- Removes avoidable first-token delay after fast deterministic tools.
- Reduces local inference work and perceived latency.
- Keeps default reasoning behavior for all non-opt-in tools.

## Security notes

- Streamdown integration is configured with `skipHtml` in
  `StreamdownMessage.tsx`.
- Tool/event UI remains driven by structured agent events, not by parsing
  model text.

If future renderer integrations allow raw HTML, they must be explicitly
reviewed and hardened before becoming defaults.

## Lift plan for web-ai-kit

Expected package boundaries:

- `packages/agent`:
  - `loop.ts`, `events.ts`, `transforms.ts`, `types.ts`, tools contracts
- `packages/agent-react`:
  - `useAgent` and React-oriented stream projections
- `packages/agent-ui` (optional):
  - transcript + renderer registries
  - default adapters (`react-markdown`, default tool cards)
- optional integration packages:
  - `agent-ui-streamdown` (renderer adapter)

Practical rule:

- Core packages export **events + adapter interfaces**.
- Host apps own the visual renderer choices.

## How to add a new renderer

1. Add renderer component (for example `FooMessage.tsx`).
2. Register id in `transcriptRenderers.tsx` and/or `toolRenderers.tsx`.
3. Set `transcriptRendererId`/`toolRendererId` in a preset.
4. Validate in `#experimental/agent` against both default and custom presets.

