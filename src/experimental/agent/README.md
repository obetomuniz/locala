# Experimental agent (`src/experimental/agent/`)

A working prototype of the on-device agent loop proposed in
[`web-ai-sdk/kit/.ideas/agent.md`](https://github.com/obetomuniz/web-ai-sdk/tree/main/kit/.ideas/agent.md).
No kit-layer package ships yet; this is the proof-of-life that informs
the package design before any of it is released. Implemented entirely
on top of the `@web-ai-sdk` packages locala already ships.

## Tool calling: native

The agent uses the Prompt API's **native** tool calling. Tools are passed
to `createSession({ tools })` (`@web-ai-sdk/prompt` ≥0.5.1) and the model's
trained `tool_code` output (`print(fetch_url(url="…"))`) is parsed and
dispatched. An earlier `responseConstraint` JSON polyfill ("constraint
mode") was removed once native proved reliable and faster on-device — see
[`web-ai-sdk/.ideas/native-tool-calling.md`](https://github.com/obetomuniz/web-ai-sdk).

Native execution itself isn't wired on current stable Chrome (the model
surfaces calls as `tool_code` text, which is why we parse it); when Chrome
ships execution, the same `tools` passthrough starts working with no
consumer changes.

## Folder layout

```
agent/
  createAgent.ts   — public factory (the entry point consumers import)
  loop.ts          — the run loop: session lifecycle, step loop, abort
  toolCode.ts      — parse the model's `tool_code` calls (safe, no eval)
  a2ui/            — A2UI v0.8 generative UI (see a2ui/README.md)
  dispatcher.ts    — execute tool calls in parallel, stream progress
  events.ts        — AgentStream (async-iterable + result promise)
  transforms.ts    — pipe-able stream transforms (onlyType, addTiming…)
  types.ts         — AgentEvent / AgentTool / AgentStream / options
  errors.ts        — typed agent errors
  tools/           — tool DEFINITIONS + the WebMCP-bridging registry
    clock.ts  fetchUrl.ts  summarize.ts  translate.ts
    detectLanguage.ts  clipboard.ts  registry.ts  index.ts
  react/           — `useAgent` hook
  index.ts         — public barrel
```

## Architecture

```
                 ┌──────────────────────────────────────────────┐
                 │ createAgent.ts → loop.ts                      │
                 │   session lifecycle + step loop + abort       │
                 │   emits step_start / step_end / message / done│
                 └─────┬─────────────────────┬──────────────────┘
                       │ yield*              │ yield*
                       ▼                     ▼
        ┌────────────────────────┐  ┌────────────────────────┐
        │ toolCode.ts            │  │ dispatcher.ts          │
        │  parse the model's     │  │  parallel tool dispatch│
        │  `tool_code` calls     │  │  + tool_progress chan  │
        │  (name + args), safe   │  │  → tool_call           │
        │  non-evaluating parser │  │  → tool_progress*      │
        │                        │  │  → tool_result         │
        └────────────────────────┘  └────────────────────────┘

        ─────────────── consumer surface ─────────────────
        ┌──────────────────────────────────────────────────┐
        │ events.ts          types.ts        transforms.ts │
        │ AgentStream        AgentEvent      pipe-able fns │
        │   - asyncIterator  AgentTransform  - onlyType    │
        │   - pipe()         AgentStream     - addTiming   │
        │   - result         CreateAgentOpts - debounceText│
        │                                    - logEvents   │
        │                                    - tee, map…   │
        └──────────────────────────────────────────────────┘
```

`createAgent.ts` is the stable public entry; the loop lives in `loop.ts`.

### Why this shape

1. **The orchestrator orchestrates, it doesn't parse.** Anything that
   touches the model's wire format lives in `toolCode.ts`. Anything
   that touches tool execution lives in `dispatcher.ts`. The
   orchestrator just yields from those generators and decides when to
   stop.

2. **Events are the public ABI.** Every consumer (React hook,
   transcript UI, raw event log, an SSE adapter you might write
   later) speaks the same vocabulary. Adding a new event variant is
   additive — the discriminated union forces exhaustive `switch` so
   consumers that need to learn the new event get a TypeScript error
   at the right place.

3. **`AgentStream` separates iteration from result.** The same run
   produces an async iterable of events AND a `Promise<AgentRunResult>`.
   Callers pick whichever they need (or both); they never have to
   "accumulate the result themselves" while also reacting to deltas.

4. **Transforms compose without ceremony.** Every transform is
   `(AsyncIterable<In>) => AsyncIterable<Out>`. No classes, no DI, no
   subscription model. They mix with hand-rolled generators trivially
   because that's what they ARE.

## Event vocabulary

| Event           | Payload                                                       | When                                                          |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `step_start`    | `{ index }`                                                   | Opens a step                                                  |
| `step_end`      | `{ index }`                                                   | Closes a step (after tools settle / final emits)              |
| `plan_delta`    | `{ index, raw }`                                              | Raw model output chunks (the streaming `tool_code` / answer)  |
| `thought`       | `{ index, text }`                                             | Synthesized from any prose the model writes before a call     |
| `plan`          | `{ index, plan }`                                             | Once a turn's parsed calls / final answer are known           |
| `tool_call`     | `{ index, callId, name, input }`                              | Before any tool starts running                                |
| `tool_progress` | `{ callId, name, data }`                                      | Whenever a tool calls `ctx.emit(data)`                        |
| `tool_result`   | `{ index, callId, name, output? \| error?, durationMs }`      | When a tool resolves or rejects                               |
| `text_delta`    | `{ delta }`                                                   | Characters of the final `message` as they stream              |
| `message`       | `{ text }`                                                    | Once after `text_delta`s drain (or only event when not streaming) |
| `a2ui_message`  | `{ index, message }`                                          | One A2UI v0.8 server message (see [`a2ui/README.md`](./a2ui/README.md)) |
| `done`          | `{ reason, text }`                                            | Terminal event, always last, exactly once per run             |

`reason ∈ "done" | "budget_exhausted" | "aborted" | "tool_error" | "unavailable" | "context_overflow" | "stalled"`.

## Generative UI (A2UI)

Optional `createAgent({ a2ui: { enabled: true } })`. Surfaces arrive as
`a2ui_message` events; the playground preset synthesizes UI from constrained
JSON when on-device models cannot emit valid JSONL. Overview:
[`a2ui/README.md`](./a2ui/README.md).

## Composition examples

### Iterate every event

```ts
import { createAgent } from "./src/experimental/agent";

const agent = createAgent({ tools: [...] });
for await (const ev of agent.runStreaming("Find boots under $150")) {
  // typed switch over ev.type
}
```

### Stream only the final answer text

```ts
import { textStream } from "./src/experimental/agent";

const stream = agent.runStreaming("Summarize the catalog");
for await (const chunk of textStream(stream)) {
  process.stdout.write(chunk);
}
const result = await stream.result; // typed AgentRunResult, same run
```

### Add timing + log + debounce

```ts
import { addTiming, logEvents, debounceText } from "./src/experimental/agent";

agent
  .runStreaming("…")
  .pipe(addTiming())
  .pipe(logEvents(console))
  .pipe(debounceText(50));
```

### Filter to a single event type (typed narrowing)

```ts
import { onlyType } from "./src/experimental/agent";

for await (const call of agent.runStreaming("…").pipe(onlyType("tool_call"))) {
  // `call` is typed as the tool_call variant — full payload typing
}
```

### Fan out to two consumers

```ts
import { tee } from "./src/experimental/agent";

const stream = agent.runStreaming("…");
const [forUi, forLog] = tee(stream);
// `stream.result` still works regardless of which branch you await.
```

### Tools can stream their own progress

```ts
const fetchUrl: AgentTool<{ url: string }, ...> = {
  name: "fetch_url",
  description: "…",
  inputSchema: { /* … */ },
  async execute({ url }, { signal, emit }) {
    emit({ phase: "request", url });
    const res = await fetch(url, { signal });
    emit({ phase: "received", status: res.status });
    const body = await res.text();
    emit({ phase: "decoded", bytes: body.length });
    return { status: res.status, body };
  },
};
```

Each `emit(data)` call surfaces as a `tool_progress` event with the
parent `callId` and the tool name attached. A transcript UI can render
those as a live progress trail under the tool card without the kit
constraining what `data` looks like.

### React

```tsx
import { useAgent } from "./src/experimental/agent/react";

const { status, text, steps, events, getStream, run, abort } = useAgent({
  systemPrompt: "…",
  tools,
  maxSteps: 5,
});

// `text` and `steps` are React-state projections of the same event
// stream. For advanced cases:
const stream = getStream("…");
stream.pipe(debounceText(80)).pipe(/* whatever */);
```

## Session model: warm base + per-run clone

A single **base** session (system prompt + tools) is created once and kept
alive to keep the on-device model warm. Each `run()` / `runStreaming()`
**clones** the base (`Session.clone()`, `@web-ai-sdk/prompt` 0.5+) for a
fresh conversation, and destroys the clone when the run ends, aborts,
throws, or the consumer breaks the iterator early (the generator's
`finally` is the single teardown owner).

This is Chrome's documented best practice for multi-task use, and it fixes
the two failure modes of the alternatives:

- **No cross-run pollution / "caching."** Each run starts from a clean
  cloned conversation, so it never replays a previous run's answer.
- **No context accretion.** A reused session grows the native context
  window until `QuotaExceededError`; a fresh clone resets it each run.
- **No recreate-degradation.** Repeated `create()` calls yield a
  pathologically slow second instance; cloning a warm base avoids that.
- **Abort is reliable.** Stop tears down the run's clone; an aborted run
  can't keep streaming into stale UI.

Cloning inherits the system prompt without re-parsing it and without a
full `create()`, so it's cheap and the model stays loaded between runs.

## Anti-hallucination: deterministic, not model-retried

On-device models of this size (~4k context) confabulate the contents of
URLs / files they can't actually read — e.g. a CORS-blocked blog URL
where `fetch_url` fails, leaving the model to invent a summary from the
slug. Prompting cannot reliably prevent this, and an earlier
model-retry "guard" was brute force (extra inference trying to force
compliance the model can't guarantee).

The kept solution is a **deterministic post-condition** with zero extra
model calls: if the input contained a URL, a fetch tool was available,
and no fetch succeeded during the run, the final answer is prepended
with an "unverified" disclaimer. It's an assertion on the run's
observable outcome, not an attempt to change the model's behavior. The
transcript remains the source of truth — if there's no successful
`fetch_url` result, the answer wasn't grounded in real content.

## Termination guarantees

- The loop ends as soon as a turn yields no `tool_code` call — that reply
  is the final answer.
- `maxSteps` bounds the loop; if it's exhausted the run stops with
  `budget_exhausted`.
- A per-step no-progress window abandons a wedged generation with
  `stalled` rather than hanging (the on-device model can freeze
  mid-generation under sustained use).
- If the model emits a tool call in a shape the parser can't read (a
  JSON-object form, an invented name), the turn is treated as final with
  an honest "couldn't parse this time — re-run" note instead of printing
  raw call scaffolding to the user.

## Lift plan

Folder maps 1:1 to a future package:

```
src/experimental/agent/        →   packages/agent/src/
src/experimental/agent/react/  →   packages/agent/src/react/
src/experimental/agent/tools/  →   packages/agent-tools/src/  (separate package)
```

The only edit needed on lift is to make the relative imports peer
dependencies (`@web-ai-sdk/prompt`, `@web-ai-sdk/webmcp`). The event
vocabulary, `AgentStream`, transforms, and the `loop` / `toolCode` /
`dispatcher` split all become the kit's public surface unchanged.
