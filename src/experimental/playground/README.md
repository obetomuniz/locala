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

Refinement: the **first** answer token is painted synchronously instead of
waiting for the next animation frame; subsequent tokens stay coalesced. This
removes the one frame (~8-16ms) of app-layer delay before the answer begins
without reintroducing per-token render churn (`useAgent.ts`,
`hasPaintedFirstText`). The consumed native stream order is never changed —
deltas are accumulated and flushed in order.

## Decision 7: `returnDirect` tool fast-path (use sparingly)

Tools may opt into returning their output directly as the final response,
skipping the extra post-tool model synthesis turn.

- Tool metadata: `AgentTool.returnDirect`
- Loop routing: `resolveDirectReturnText()` in `agent/loop.ts`
- Current opt-in tools: none (the mechanism remains for future tools)

Why and the caveat:

- It removes avoidable first-token delay after a tool whose output IS
  unambiguously the final answer.
- But it is only safe when the tool can't be *misrouted*. `summarize_text`
  was opted in originally and we removed it (Decision 9): the small on-device
  model sometimes calls it for "write an article" requests, and `returnDirect`
  turned that misroute into a fatal short-circuit — a one-line summary
  replacing the whole answer. Without `returnDirect`, the summary is fed back
  as a tool result and the model recovers.
- Rule of thumb: only set `returnDirect` on tools whose invocation is
  unambiguous and whose raw output is always an acceptable final answer
  (e.g. a clipboard read), never on transform tools the model might misapply.

## Decision 8: Eager (deterministic) fetch for URLs in the input

When the user's message contains URLs and a URL-fetching tool is available,
the loop fetches them all up front — in parallel — before the model writes
anything, then hands the results to a single answer turn.

- Loop path: the proactive-fetch block in `agent/loop.ts` (guarded by
  `autoFetchUrls && fetchTool && inputUrls.length >= 1`)
- Reactive backstop downstream still covers model-driven fetches of URLs that
  weren't in the original input.

Why:

- The URL is in the input, so fetching it is **deterministic, not
  speculative** — there's no misprediction risk. It just enforces what the
  platform system prompt already mandates ("for ANY URL, fetch first").
- It removes the model's initial "decide to call `fetch_url`" planning turn.
  On-device, every model turn carries a multi-second first-token cost, so
  collapsing a URL flow from two turns to one is the biggest TTFT win for
  "summarize/answer about this link" prompts.

Critical correctness note (regression we hit and fixed): because the eager
path skips the planning turn, **the user's message is never sent on its own**.
The synthesis turn must therefore fold the original request in alongside the
tool results:

```
turnInput = `The user asked: ${input}\n\n${toolResults}\n\n${closer}`;
```

Without this, the model only sees raw tool output plus a generic "answer the
request" and has no idea what was asked — it summarizes generically and picks
fields inconsistently (e.g. answering "how many stars" with watchers, license,
topics). Folding the question back in restores the on-target, consistent
answers of the pre-eager model-driven flow — and does so with **no answer-
brevity prompt tuning** (see Non-goals).

## Decision 9: Make tool misrouting non-fatal, not prompt-perfect

The small on-device model is *tool-trigger-happy*: the native system prompt
necessarily lists every tool and teaches the `tool_code` format, which primes
the model to reach for a tool even on tasks that need none (observed:
"generate a 300-word article" repeatedly calling `summarize_text`, or emitting
malformed `tool_code`). Steering this purely with prompt wording is
unreliable, so the fix is structural — recover from a misroute instead of
trying to prevent every one:

1. Precise tool descriptions as the routing contract. A tool's `description`
   defines *when* to call it. `summarize_text` now says "condense EXISTING
   text the user supplied … do NOT use to write/generate new content"
   (`tools/summarize.ts`). This reduces misroutes but does not eliminate them.
2. No `returnDirect` on transform tools (see Decision 7). A misrouted
   `summarize_text` call returns its output as a tool *result*, so the loop
   continues and the model still produces the requested content.
3. One-time self-heal in the loop. When the model emits tool-call-like text
   that doesn't parse to a valid call, the loop retries ONCE with "answer
   directly, no tools" instead of showing a canned "re-run" message
   (`directRetryDone` in `agent/loop.ts`). The original request is already in
   session history, so the retry produces the real answer.
4. Per-tool `acceptCall` dispatch gates (`dispatchPolicy.ts`). Routing intent
   stays in each tool's JSON Schema `description`; the loop filters proposed
   calls through `tool.acceptCall(input, runCtx)` only. Examples:
   `summarize_text` requires `text` provenance from the user message or a
   fetch this run; `fetch_url` requires a URL the user actually named. When
   every proposed call is rejected, one `DIRECT_ANSWER_RETRY` turn runs — no
   tool-specific branches in `loop.ts`.

Why this shape:

- Prompt-only steering of a small model is not robust; defense-in-depth that
  degrades gracefully is.
- It keeps the engine native (no scaffolding that fakes output) while making
  the common failure modes recoverable rather than user-visible.

## Non-goals: rely on native performance, not brute force

Things we deliberately did NOT do, validated by measurement:

- **No throughput hacks.** On-device token rate (~100 ch/s here) and per-turn
  first-token latency are model/hardware bound. We don't fake tokens,
  parallelize sessions, or spin up workers to "speed up" generation.
- **No system-prompt trimming for speed.** Measured a no-op: the warm base
  session caches the system-prompt prefill, so a tiny prompt (Minimal preset)
  was no faster to first token than the full tool catalog.
- **No answer-brevity prompt scaffolding.** Pushing the small model toward
  terse answers traded away accuracy (dropped or mislabeled the requested
  fact). The verbosity was a missing-context symptom (Decision 8), not a
  brevity problem; the post-fetch instruction stays at the plain native
  default.
- **No raw-HTML renderer as default** (see Security notes); Flowtoken was
  evaluated and removed (unmaintained, `rehype-raw` by default, and no
  measurable speed gain over Streamdown).

The optimizations we kept live only in two layers that don't touch native
inference: UI render cadence (Decision 6) and agent orchestration (Decisions
2, 7, 8).

## Measured performance findings (chrome-devtools, on-device)

Reference numbers from instrumented runs, so future work optimizes the right
thing:

- Session clone acquisition + context probing: **~1ms** (the Decision 2
  prefetch works; session warmup is not a bottleneck).
- Render path during streaming: **0 long tasks, 0 jank** — rendering is not
  the bottleneck; throughput is model-bound.
- Time-to-first-token is dominated by the model's intrinsic per-turn
  first-token latency, not app-layer cost. Caveat: absolute TTFT measured via
  an external driver is inflated by the driver's input latency; trust in-page
  instrumentation and phase **differences**, not absolute numbers.
- The on-device model degrades under sustained heavy use (matches the
  in-app "Reset session" affordance); a page reload does not reset it.

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

## Decision 6: Generative UI (A2UI) preset

The **Generative UI (A2UI)** preset exercises declarative UI on the agent
event bus (`a2ui_message`), with a React renderer in `a2ui/A2uiView.tsx`.
On-device models use a constrained JSON → synthesize path; dashed example
chips load static surfaces without inference.

Protocol overview and module map:
[`../agent/a2ui/README.md`](../agent/a2ui/README.md).

