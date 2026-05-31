# On-device model stability — findings & mitigations

The biggest source of bad UX in the agent playground is **not** the agent
loop or the rendering — it's the on-device model (Chrome's Prompt API /
Gemini Nano) becoming slow and flaky under sustained use within a page
session. This doc records what we observed, what Chrome's official docs
say, and the mitigations the prototype ships.

## Root cause of fabrication: tool-calling is not native (yet)

The deepest finding: Chrome's stable Prompt API has **no native tool
calling** ("Tool calling: No (planned)" per Chrome's docs / the W3C
spec). This agent therefore **polyfills** it — it uses
`responseConstraint` to make the model emit JSON describing a tool call,
then parses + dispatches it manually (`planner.ts` + `dispatcher.ts`).
Because the on-device model isn't tuned for this ad-hoc protocol, it
intermittently ignores it and **fabricates** from training data
("123 stars" without fetching; "10/27/2023" without calling the clock
tool — note that's a training-cutoff date).

This is the real source of the "sometimes uses the tool, sometimes
doesn't" instability, and it's **not** fully fixable at the loop level —
it's the gap between a tool-tuned model + native protocol and a model
prompted to fake it.

The W3C Prompt API spec already defines a native `tools` option (the
user agent invokes `execute` and feeds the result back), and Chrome is
prototyping it (experimental / Origin Trial). When the SDK can wrap it,
the agent should switch from synthesized tool-calling to native — that's
the fix at the source. Tracked in
`web-ai-sdk/.ideas/session-resilience-handoff.md`. Note this is
ORTHOGONAL to `clone()` (session lifecycle); both are used together.

## What we observed (our own evidence, via Chrome DevTools)

Captured live with `chrome-devtools-mcp` (performance trace + a DOM
sampler):

- A **fresh-page first run** completes a 2-step run (~11.7s) with the UI
  updating live: events progressed `1 → 2 → 5 → 10 → 11 → 15` and the
  answer was correct ("13 stars"). **No render bug** — INP was 2ms, the
  main thread was responsive throughout.
- **Subsequent runs in the same session** frequently degrade: the
  planning turn's stream *dribbles* tokens so slowly the constrained JSON
  never completes ("stuck on planning"), or stalls outright. A DOM
  sampler running every 250ms for 40s showed the committed DOM frozen at
  "planning / 2 events" — confirming the run was genuinely stuck in the
  model turn, not a starved render (a `setInterval` macrotask fired 160×
  and never flushed a further frame).
- The degradation **persists across page reloads** sometimes (the model
  is a browser-process resource, not page-scoped), and worsens the more
  runs you do. Two distinct failure modes show up intermittently:
  1. **Stall** — the model freezes / dribbles and the turn never
     completes.
  2. **Fabrication** — the model skips the tool entirely and answers from
     its priors (e.g. "101 stars" instead of fetching the real 13).

This single-session sustained-degradation is **not** something we found
documented officially; treat it as an empirical observation of an
experimental API.

## What Chrome's official docs DO say

Sources:
- [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- [Session management best practices](https://developer.chrome.com/docs/ai/session-management)
- [Built-in AI APIs: do & don't](https://developer.chrome.com/docs/ai/built-in-ai-dos-donts)

Relevant points:

1. **Keep a session alive to keep the model loaded.** *"The model is
   unloaded after a period of time if there are no living sessions. Thus,
   you likely want to keep one empty session alive at a time… it keeps
   the model ready to use."* → don't let the model unload between runs.
2. **Base session + `clone()` is the official multi-task pattern.**
   Create a base session with only the system prompt, then `clone()` it
   per task. This:
   - avoids re-parsing heavy system instructions (latency + resources),
   - avoids context bleed between unrelated tasks (our "caching" bug),
   - is cheaper than a fresh `create()`.
   *"Don't reuse the same session for unrelated tasks… Don't repeatedly
   call `create()` with identical, heavy system instructions. Use the
   cloning pattern instead."*
3. **`destroy()` unused sessions; don't keep multiple large sessions
   alive.** Memory pressure from many sessions degrades performance.
4. **Context window**: `contextUsage` / `contextWindow`, the
   `contextoverflow` event, and `measureContextUsage()` let you manage
   overflow before it throws `QuotaExceededError`.
5. **Let the user stop the model** with `AbortController` to preserve
   quota.

## Mitigations the prototype ships

| Mitigation | Failure mode it addresses | File |
| --- | --- | --- |
| **Base session + per-run `clone()`** (`@web-ai-sdk/prompt` 0.5+) — one warm base holds the system prompt; each run clones it for a fresh conversation | cross-run "caching" AND recreate-degradation (clone is cheap, doesn't spawn a degraded 2nd instance); keeps model loaded | `createAgent.ts` |
| **Stall retry** — a stalled planning turn is retried on the same session (3 attempts), cancelling the wedged generation first | intermittent **stall** (self-heals) | `planner.ts` |
| **Per-attempt time budget + no-progress race** | bounds frozen / dribbling turns so they never hang forever | `planner.ts` |
| **Deterministic auto-fetch** — when the user references a URL and the model finalizes without fetching, the orchestrator fetches it itself and forces one more turn (bounded to once; NOT a model retry) | **fabrication** (fixes it for explicit fetch prompts) | `createAgent.ts` |
| **Deterministic "unverified" disclaimer** when a URL was given but no fetch succeeded (e.g. CORS-blocked) | **fabrication** that can't be auto-fixed (flags it; zero extra inference) | `createAgent.ts` |
| **`thought` chain-of-thought ON by default** | reduces (not eliminates) fabrication — the scratchpad nudges tool use | `schema.ts` |
| **Reset = full page reload** | the only reliable fresh+fast session | `AgentPlayground.tsx` |
| **Output-language hint** (`language: "en"`) | Chrome warns it degrades quality without one | playground |

## Adopted: base-session + `clone()` (since `@web-ai-sdk/prompt` 0.5.0)

The official answer to BOTH the cross-run "caching" problem AND a chunk
of the instability is the base-session + `clone()` pattern. As of
`@web-ai-sdk/prompt` 0.5.0 the SDK exposes `Session.clone()`, and the
experiment now uses it (`createAgent.ts`):

- ONE base session (system prompt only), created once and kept alive
  (model stays warm),
- each run `clone()`s the base → fresh conversation, no system-prompt
  re-parse, no caching, and crucially NOT a second `create()` (which is
  what degraded Chrome's single instance),
- the clone is `destroy()`ed when the run ends; the base lives on.

If the browser instance doesn't support `clone()` (older Chrome), the
agent falls back to a fresh `createSession` per run (works, but can
degrade over many runs).

0.5.0 also let us drop two workarounds: `PromptAbortError` is now
exported (so abort is matched by `instanceof`, not a name string), and
`omitResponseConstraintInput` is available on `SessionSendOptions` (a
token-saving option we can opt into later — left off for now to keep the
schema visible to the model for correctness).

## Future `useAgent` / `@web-ai-kit/agent` resilience knobs

Candidates surfaced by this exploration (not all implemented):

- `planAttempts` (retry budget for stalled/invalid planning turns) —
  implemented as a constant; should be an option.
- `attemptTimeoutMs` / `stallTimeoutMs` — expose the no-progress windows.
- `onStall` / `onRetry` callbacks so a host UI can show "the model is
  slow, retrying…" affordances.
- A `degraded` signal: after N stalls in a session, surface a "reload to
  reset the model" prompt automatically.
- Base-session + `clone()` per run, once the SDK supports it.
