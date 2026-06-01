/**
 * `createAgentLoop` — the agent's run loop. `createAgent.ts` is the public
 * factory; this is the implementation it delegates to.
 *
 * Tool calling is NATIVE: tools are passed to `createSession({ tools })`
 * (@web-ai-sdk/prompt ≥0.5.1) and the model's trained `tool_code` output
 * (`print(fetch_url(url="…"))`) is parsed and dispatched. Per run it:
 *
 *   1. clones a warm base session (system prompt + tools) for a fresh,
 *      cheap conversation (see the session-lifecycle notes below),
 *   2. streams the model's reply and parses any `tool_code` calls
 *      (`toolCode.ts`),
 *   3. dispatches them through `runDispatcher` (same tool events as any
 *      other consumer), feeds the results back, and
 *   4. repeats until the model answers in plain text.
 *
 * Native EXECUTION isn't wired on stable Chrome yet (the model surfaces
 * calls as `tool_code` text, which is why we parse it); if a future
 * runtime executes tools directly, the provided `execute` callbacks run
 * and this loop simply sees no `tool_code` and emits the final message.
 * See `web-ai-sdk/.ideas/native-tool-calling.md`.
 */

import {
  createSession,
  isAvailable as isPromptAvailable,
  PromptAbortError,
  PromptUnavailableError,
  type LanguageModelTool,
  type Session,
} from "@web-ai-sdk/prompt";
import { runDispatcher } from "./dispatcher";
import { AgentStalledError, AgentUnavailableError } from "./errors";
import { streamFromGenerator, streamFromResult } from "./events";
import { parseToolCode, stripToolCode } from "./toolCode";
import type {
  Agent,
  AgentEvent,
  AgentRunResult,
  AgentStep,
  AgentStopReason,
  AgentTool,
  AgentToolCallRecord,
  CreateAgentOptions,
} from "./types";

const DEFAULT_MAX_STEPS = 5;
const STALL_TIMEOUT_MS = 15_000;
// Fallback fetch-content budget (chars), used only when the browser doesn't
// report the context window. When it does (`session.contextWindow`), the
// budget is sized to the real model — see the per-run calc in `loop()`.
const FETCH_CONTENT_BUDGET_CHARS = 8000;
// Convert the token-based context window to a char budget (~4 chars/token),
// reserving headroom for the answer + per-turn framing, with a floor so a
// page always gets some content.
const CHARS_PER_TOKEN = 4;
const ANSWER_RESERVE_TOKENS = 768;
const MIN_FETCH_BUDGET_CHARS = 1000;
// Per-URL cap for MULTI-doc runs. Counter-intuitively, giving each page MORE
// content hurts multi-doc coverage: filling the small context leaves the
// model no room to synthesize across pages, so it answers about only one.
// Capping each page to a synthesis-friendly size (and letting the dynamic
// budget shrink it further when there are many URLs) keeps every page
// covered. Single-URL runs aren't capped — there's nothing to synthesize.
const MULTI_DOC_PER_URL_MAX_CHARS = 4000;

export function createAgentLoop(options: CreateAgentOptions = {}): Agent {
  const tools = (options.tools ?? []).slice();
  if (!isPromptAvailable()) return makeUnavailableAgent(tools);

  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const onToolError = options.onToolError ?? "report";
  // URL safety net (same intent as the constraint loop): if the user
  // referenced a URL and a fetch tool exists, fetch it deterministically
  // when the model finalizes without fetching, and flag any URL answer
  // that wasn't backed by a successful fetch.
  const autoFetchUrls = options.autoFetchUrls ?? true;
  const systemPrompt = buildNativePrompt(options.systemPrompt, tools);
  // The `tools` passthrough on `createSession` (since @web-ai-sdk/prompt
  // 0.5.1) is what lets this run through the SDK instead of reaching for
  // `globalThis.LanguageModel`. The SDK forwards `tools` to the native
  // `create()`; on stable Chrome the model surfaces calls as `tool_code`
  // text, which `toolCode.ts` parses (the SDK does NOT execute tools).
  const sdkTools = tools.map(toSdkTool);

  // Same base-session + per-run-clone lifecycle as the constraint agent
  // (see createAgent.ts): one warm base holding the system prompt + tools,
  // cloned per run for a clean conversation without re-parsing or a fresh
  // create().
  let baseSession: Session | null = null;
  let currentController: AbortController | null = null;
  let currentClone: Session | null = null;
  let prefetchedClone: Session | null = null;
  let prefetchInFlight: Promise<void> | null = null;
  let prefetchEpoch = 0;
  let destroyed = false;

  const getBase = (): Session => {
    if (!baseSession) {
      baseSession = createSession({
        systemPrompt,
        temperature: options.temperature,
        topK: options.topK,
        language: options.language,
        tools: sdkTools,
      });
    }
    return baseSession;
  };

  const acquireRunSession = async (): Promise<Session> => {
    const base = getBase();
    try {
      return await base.clone();
    } catch {
      return createSession({
        systemPrompt,
        temperature: options.temperature,
        topK: options.topK,
        language: options.language,
        tools: sdkTools,
      });
    }
  };

  const invalidatePrefetchedClone = () => {
    prefetchEpoch++;
    if (prefetchedClone) {
      prefetchedClone.destroy();
      prefetchedClone = null;
    }
  };

  const prefetchRunClone = () => {
    if (destroyed || prefetchedClone || prefetchInFlight) return;
    const epoch = prefetchEpoch;
    prefetchInFlight = (async () => {
      let session: Session | null = null;
      try {
        session = await acquireRunSession();
      } catch {
        return;
      }
      if (destroyed || epoch !== prefetchEpoch || prefetchedClone) {
        session.destroy();
        return;
      }
      prefetchedClone = session;
    })().finally(() => {
      prefetchInFlight = null;
    });
  };

  const takeRunSession = async (): Promise<Session> => {
    if (prefetchedClone) {
      const session = prefetchedClone;
      prefetchedClone = null;
      return session;
    }
    if (prefetchInFlight) {
      try {
        await prefetchInFlight;
      } catch {
        // Best-effort warmup only. Fall back to on-demand clone below.
      }
      if (prefetchedClone) {
        const session = prefetchedClone;
        prefetchedClone = null;
        return session;
      }
    }
    return acquireRunSession();
  };

  // Pre-warm the model while the user reads the UI (mirrors the
  // constraint agent), so the first run can claim a ready clone.
  getBase();
  prefetchRunClone();

  async function* loop(
    input: string,
    externalSignal?: AbortSignal,
  ): AsyncGenerator<AgentEvent, AgentRunResult, void> {
    if (destroyed) throw new AgentUnavailableError("Agent has been destroyed.");

    currentController?.abort();
    currentClone?.destroy();
    const controller = new AbortController();
    currentController = controller;
    const signal = composeSignals(controller.signal, externalSignal);

    const inputUrls = extractUrls(input);
    const fetchTool =
      inputUrls.length > 0 ? findUrlFetchingTool(tools) : undefined;

    const session = await takeRunSession();
    currentClone = session;

    // Size the fetch-content budget to the model's ACTUAL context. A cloned
    // session reports `contextWindow` (max input tokens) and `contextUsage`
    // (≈ the system prompt on a fresh clone) the moment it's live
    // (@web-ai-sdk/prompt 0.5.2). Reserve headroom for the answer; fall back
    // to the fixed cap when the browser doesn't report the window. Splitting
    // the budget evenly per URL lets all pages fit at once → fetch them all,
    // then one streamed answer covering each.
    const budgetChars = (() => {
      const windowTokens = session.contextWindow;
      if (!windowTokens) return FETCH_CONTENT_BUDGET_CHARS;
      const usedTokens = session.contextUsage ?? 0;
      const availableTokens = windowTokens - usedTokens - ANSWER_RESERVE_TOKENS;
      return Math.max(MIN_FETCH_BUDGET_CHARS, availableTokens * CHARS_PER_TOKEN);
    })();
    const perResultMaxChars =
      inputUrls.length > 1
        ? Math.min(
            Math.floor(budgetChars / inputUrls.length),
            MULTI_DOC_PER_URL_MAX_CHARS,
          )
        : budgetChars;

    const steps: AgentStep[] = [];
    let turnInput = input;
    let stopReason: AgentStopReason | null = null;
    let finalText = "";

    // Track which of the user's URLs were actually fetched — PER URL, not
    // just "any fetch happened" — so we can force-fetch the ones the model
    // skipped (it often fetches only the first of several) and flag failures.
    const fetchedOk = new Set<string>();
    const fetchTried = new Set<string>();
    let autoFetchDone = false;
    const recordFetches = (records: AgentToolCallRecord[]) => {
      if (!fetchTool) return;
      for (const r of records) {
        if (r.name !== fetchTool.name) continue;
        const url = (r.input as { url?: unknown }).url;
        if (typeof url !== "string") continue;
        fetchTried.add(normUrl(url));
        if (fetchDidSucceed(r)) fetchedOk.add(normUrl(url));
      }
    };

    let stepIndex = 0;
    try {
      // Proactive fetch-all (multi-URL): fetch EVERY URL up front, in
      // parallel, so the model has all the pages BEFORE it writes anything —
      // the "fetch all → one answer" flow. Without this the model interleaves
      // (fetch → answer page 1 → fetch → answer page 2). The reactive
      // backstop further down still covers the single-URL / model-driven
      // cases.
      if (autoFetchUrls && fetchTool && inputUrls.length >= 2) {
        yield { type: "step_start", index: stepIndex };
        const fetchCalls = inputUrls.map((url) => ({
          name: fetchTool.name,
          input: { url },
        }));
        const { records } = yield* runDispatcher({
          tools,
          calls: fetchCalls,
          stepIndex,
          signal,
        });
        steps.push({
          index: stepIndex,
          plan: { toolCalls: fetchCalls },
          toolCalls: records,
        });
        yield { type: "step_end", index: stepIndex };
        recordFetches(records);
        // The URLs are already fetched; don't let the reactive backstop
        // re-fetch (a CORS failure here would just fail again).
        autoFetchDone = true;
        turnInput = `${buildToolResultTurn(records, perResultMaxChars)}\n\nUsing ALL the fetched content above, answer the user's request now in ONE reply that covers every URL.`;
        stepIndex++;
      }

      for (; stepIndex < maxSteps; stepIndex++) {
        if (signal.aborted) {
          stopReason = "aborted";
          break;
        }
        yield { type: "step_start", index: stepIndex };

        let reply: string;
        try {
          reply = yield* streamReply(session, turnInput, signal, stepIndex, tools);
        } catch (err) {
          if (err instanceof PromptAbortError || isAbort(err)) {
            stopReason = "aborted";
          } else if ((err as Error)?.name === "QuotaExceededError") {
            stopReason = "context_overflow";
            finalText =
              "The on-device model's context window filled up on this run. Try again — the next run starts from a fresh cloned session.";
          } else if (err instanceof AgentStalledError) {
            stopReason = "stalled";
            finalText = err.message;
          } else if (err instanceof PromptUnavailableError) {
            stopReason = "unavailable";
          } else stopReason = "unavailable";
          yield { type: "step_end", index: stepIndex };
          if (finalText) yield { type: "message", text: finalText };
          break;
        }

        if (signal.aborted) {
          stopReason = "aborted";
          yield { type: "step_end", index: stepIndex };
          break;
        }

        const calls = parseToolCode(reply, tools);

        if (calls.length === 0) {
          // Deterministic auto-fetch (NOT a model retry): the user named
          // URLs and the model is finalizing with some still unfetched —
          // i.e. about to answer about pages it never read (the common
          // "fetched only the first of two" case). Fetch ALL the missing
          // ones ourselves in parallel, feed the real content back, and
          // force one more turn. Bounded to once per run.
          const missing = fetchTool
            ? inputUrls.filter((u) => !fetchedOk.has(normUrl(u)))
            : [];
          if (autoFetchUrls && fetchTool && missing.length > 0 && !autoFetchDone) {
            autoFetchDone = true;
            const fetchCalls = missing.map((url) => ({
              name: fetchTool.name,
              input: { url },
            }));
            const { records } = yield* runDispatcher({
              tools,
              calls: fetchCalls,
              stepIndex,
              signal,
            });
            steps.push({
              index: stepIndex,
              plan: { toolCalls: fetchCalls },
              toolCalls: records,
            });
            yield { type: "step_end", index: stepIndex };
            recordFetches(records);
            const noun = missing.length === 1 ? "the URL" : `${missing.length} URLs`;
            turnInput = `${buildToolResultTurn(records, perResultMaxChars)}\n\nYou had not fetched ${noun} the user asked about; the real content is above. Address EACH one in your answer — don't drop any.`;
            continue;
          }

          // The model sometimes emits a tool call in a shape we don't
          // parse — a JSON `{tool_name,…}` object, an invented name, or a
          // fenceless `fn(args)`. Don't print that raw scaffolding as the
          // answer; its tool-call format varies run to run, so say so and
          // suggest a re-run instead of showing code to the user.
          let answer: string;
          if (tools.length > 0 && looksLikeUnparsedToolCall(reply, tools)) {
            answer =
              "The model tried to call a tool in a format I couldn't parse this time (its tool-call format varies between runs). Re-run — it usually works on another try.";
          } else {
            answer = stripToolCode(reply) || reply.trim();
          }
          // Flag any user URL that never fetched successfully (after the
          // auto-fetch backstop, that means a real CORS/network failure).
          const unfetched = fetchTool
            ? inputUrls.filter((u) => !fetchedOk.has(normUrl(u)))
            : [];
          finalText = maybeFlagUnverifiedUrl(answer, {
            hasFetchTool: !!fetchTool,
            totalUrls: inputUrls.length,
            unfetched,
            anyTried: fetchTried.size > 0,
          });
          yield { type: "plan", index: stepIndex, plan: { final: true, message: finalText } };
          steps.push({ index: stepIndex, plan: { final: true, message: finalText }, toolCalls: [], text: finalText });
          yield { type: "step_end", index: stepIndex };
          stopReason = "done";
          yield { type: "message", text: finalText };
          break;
        }

        // A tool-calling turn. The model sometimes prefaces its `tool_code`
        // block with a sentence of reasoning ("I'll detect the language
        // first…"). Native has no dedicated reasoning channel, so surface
        // that prose as a synthesized `thought` for parity with the
        // constraint path's transcript.
        const thought = leadingProse(reply);
        if (thought) yield { type: "thought", index: stepIndex, text: thought };

        // Surface a plan so the UI flips to "tool_calling", then dispatch
        // through the shared dispatcher.
        yield {
          type: "plan",
          index: stepIndex,
          plan: {
            ...(thought ? { thought } : {}),
            toolCalls: calls.map((c) => ({ name: c.name, input: c.input })),
          },
        };
        const { records } = yield* runDispatcher({
          tools,
          calls,
          stepIndex,
          signal,
        });
        const directText = resolveDirectReturnText(calls, records, tools);
        if (directText !== null) {
          finalText = directText;
          steps.push({
            index: stepIndex,
            plan: {
              ...(thought ? { thought } : {}),
              toolCalls: calls,
              final: true,
              message: finalText,
            },
            toolCalls: records,
            text: finalText,
          });
          yield { type: "plan", index: stepIndex, plan: { final: true, message: finalText } };
          yield { type: "step_end", index: stepIndex };
          recordFetches(records);
          stopReason = "done";
          yield { type: "message", text: finalText };
          break;
        }
        steps.push({
          index: stepIndex,
          plan: { ...(thought ? { thought } : {}), toolCalls: calls },
          toolCalls: records,
        });
        yield { type: "step_end", index: stepIndex };

        // Track which URLs the model actually fetched (per-URL).
        recordFetches(records);

        const fatal = records.find((r) => r.error);
        if (fatal && onToolError !== "report") {
          stopReason = "tool_error";
          break;
        }

        turnInput = buildToolResultTurn(records, perResultMaxChars);
      }

      if (stopReason === null) stopReason = "budget_exhausted";
    } finally {
      if (currentController === controller) currentController = null;
      session.destroy();
      if (currentClone === session) currentClone = null;
      prefetchRunClone();
    }

    yield { type: "done", reason: stopReason, text: finalText };
    return { text: finalText, steps, stopReason };
  }

  return {
    get tools() {
      return tools;
    },
    async run(input, runOptions) {
      const stream = streamFromGenerator(loop(input, runOptions?.signal));
      for await (const _ev of stream) void _ev;
      return stream.result;
    },
    runStreaming(input, runOptions) {
      return streamFromGenerator(loop(input, runOptions?.signal));
    },
    abort() {
      currentController?.abort();
    },
    newSession() {
      currentController?.abort();
      currentClone?.destroy();
      currentClone = null;
      invalidatePrefetchedClone();
      baseSession?.destroy();
      baseSession = null;
      prefetchRunClone();
    },
    destroy() {
      destroyed = true;
      currentController?.abort();
      currentController = null;
      currentClone?.destroy();
      currentClone = null;
      invalidatePrefetchedClone();
      baseSession?.destroy();
      baseSession = null;
    },
  };
}

// ─── Streaming one model reply with abort + stall protection ──────────────

type RaceStep =
  | { kind: "chunk"; result: IteratorResult<string> }
  | { kind: "aborted" }
  | { kind: "stalled" };

async function* streamReply(
  session: Session,
  input: string,
  signal: AbortSignal,
  stepIndex: number,
  tools: readonly AgentTool[],
): AsyncGenerator<AgentEvent, string, void> {
  // No `responseConstraint`: native tool calling relies on the `tools`
  // attached at session creation. The SDK already normalizes chunks to
  // deltas (never cumulative), so we just accumulate.
  const stream = session.sendStreaming(input, { signal });
  const it = stream[Symbol.asyncIterator]();

  let acc = "";
  // `prose` | `tool` | undefined (undecided). Once we can tell whether
  // the reply is a plain answer or a `tool_code` call, we either stream
  // it as `text_delta` (prose) or hold it back (tool call), so the
  // answer panel never shows raw tool-call code.
  let kind: "prose" | "tool" | undefined;

  try {
    while (true) {
      if (signal.aborted) {
        void it.return?.(undefined);
        throw makeAbortError();
      }
      const step = await raceNext(it, signal, STALL_TIMEOUT_MS);
      if (step.kind === "aborted") {
        void it.return?.(undefined);
        throw makeAbortError();
      }
      if (step.kind === "stalled") {
        void it.return?.(undefined);
        throw new AgentStalledError(STALL_TIMEOUT_MS);
      }
      if (step.result.done) break;

      const delta = step.result.value;
      if (!delta) continue;
      acc += delta;

      yield { type: "plan_delta", index: stepIndex, raw: delta };

      if (kind === undefined) {
        const trimmed = acc.trimStart();
        if (trimmed.length >= 3) {
          kind =
            trimmed.startsWith("```") ||
            /tool_code/i.test(acc) ||
            parseToolCode(acc, tools).length > 0
              ? "tool"
              : "prose";
        }
      }
      if (kind === "prose") yield { type: "text_delta", delta };
    }
  } catch (err) {
    if (err instanceof AgentStalledError || isAbort(err)) throw err;
    throw err instanceof Error ? err : new Error(String(err));
  }

  return acc;
}

function raceNext(
  it: AsyncIterator<string>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<RaceStep> {
  if (signal.aborted) return Promise.resolve({ kind: "aborted" });
  return new Promise<RaceStep>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => resolve({ kind: "stalled" })),
      timeoutMs,
    );
    const onAbort = () => finish(() => resolve({ kind: "aborted" }));
    signal.addEventListener("abort", onAbort, { once: true });
    it.next().then(
      (result) => finish(() => resolve({ kind: "chunk", result })),
      (err) => finish(() => reject(err)),
    );
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function toSdkTool(tool: AgentTool): LanguageModelTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    // Forwarded to the native `create()` by the SDK. It's only invoked
    // when a runtime executes tools natively (not on stable Chrome today);
    // there we still parse the `tool_code` text ourselves. The result must
    // be a string for the native channel.
    async execute(args: unknown) {
      const out = await tool.execute(args as never, {
        signal: new AbortController().signal,
        callId: `native-${tool.name}`,
        step: 0,
        emit: () => {},
      });
      return typeof out === "string" ? out : JSON.stringify(out);
    },
  };
}

/**
 * System prompt for the native path. Even though we pass `tools` to
 * `create()`, stable Chrome doesn't reliably inject the catalog into the
 * model's context (the model invented a `datetime_fetch` tool when only
 * `clock_now` exists). So we list the real tool names + input shapes here
 * and show the exact `tool_code` format — the same catalog the constraint
 * path provides, just expressed as the call syntax the model is trained
 * to emit. This is what makes it pick the correct tool instead of
 * narrating an intent to use a made-up one.
 */
function buildNativePrompt(
  base: string | undefined,
  tools: readonly AgentTool[],
): string {
  const preamble =
    base ?? "You are a helpful, on-device assistant in the user's browser.";

  if (tools.length === 0) {
    return [preamble, "Reply to the user directly in plain text."].join("\n\n");
  }

  const catalog = tools
    .map((t) => `- ${t.name}${describeInputShape(t.inputSchema)}: ${t.description}`)
    .join("\n");

  return [
    preamble,
    `You can call these tools (use the EXACT names from this list; do not invent tools, and pick the most specific tool for the task):\n${catalog}`,
    [
      // The example is a NEUTRAL placeholder on purpose: anchoring it on a
      // real tool (e.g. `fetch_url`) biases the model into using that tool
      // for everything — observed: it tried to fetch a time API for "what
      // time is it" instead of calling the dedicated clock tool. A generic
      // shape teaches the syntax without steering tool choice.
      "When a tool is needed (e.g. to read a URL the user gave you, get the current date/time, or fetch fresh data), emit ONLY a tool_code block that CALLS the most appropriate tool — do not just describe what you will do. Format (use empty parentheses if the tool takes no arguments):",
      "```tool_code",
      'tool_name(argument="value")',
      "```",
      "If the user gives MULTIPLE URLs or asks about several items, fetch EACH one (call the tool again for each), then write ONE final answer that covers ALL of them — never answer about a URL you haven't fetched, and don't drop any.",
      "Never invent values a tool can provide. After you receive the tool results, reply to the user directly in plain text.",
    ].join("\n"),
  ].join("\n\n");
}

/** Compact `(field, field?)` signature for the tool catalog. */
function describeInputShape(schema: AgentTool["inputSchema"]): string {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const required = new Set(schema.required ?? []);
  const names = Object.keys(props);
  if (names.length === 0) return "()";
  return `(${names.map((n) => (required.has(n) ? n : `${n}?`)).join(", ")})`;
}

function buildToolResultTurn(
  records: AgentToolCallRecord[],
  maxChars: number,
): string {
  const lines = records.map((r) =>
    JSON.stringify({
      name: r.name,
      ...(r.error
        ? { error: truncate(r.error.message, 300) }
        : { output: truncateForContext(r.output, maxChars) }),
    }),
  );
  return [
    "Tool results:",
    ...lines,
    // Fetch-all → one answer: if other URLs the user mentioned aren't
    // fetched yet, fetch them first; once everything is in, write a single
    // reply that covers them all. Per-URL content is budgeted upstream so
    // they fit the small context together.
    "Use these results to answer. If the user mentioned other URLs you haven't fetched yet, fetch those first; once you have them all, write ONE reply that covers every one of them.",
  ].join("\n");
}

/**
 * Fast-path: when a single successful call targets a `returnDirect` tool,
 * finish the run with its output and skip the extra model synthesis turn.
 */
function resolveDirectReturnText(
  calls: ReadonlyArray<{ name: string; input: Record<string, unknown> }>,
  records: readonly AgentToolCallRecord[],
  tools: readonly AgentTool[],
): string | null {
  if (calls.length !== 1 || records.length !== 1) return null;
  const call = calls[0];
  const record = records[0];
  if (record.error) return null;

  const tool = tools.find((t) => t.name === call.name);
  if (!tool?.returnDirect) return null;

  return directOutputToText(record.output, tool.name);
}

function directOutputToText(output: unknown, toolName: string): string {
  if (typeof output === "string") return output.trim();
  // Summarizer returns `{ summary, cached }`; expose the summary as-is.
  if (toolName === "summarize_text" && output && typeof output === "object") {
    const summary = (output as { summary?: unknown }).summary;
    if (typeof summary === "string") return summary.trim();
  }
  if (output === null || output === undefined) return "";
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function truncateForContext(value: unknown, maxChars: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value, maxChars);
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
  if (json.length <= maxChars) return value;
  return `${json.slice(0, maxChars - 16)}…[truncated]`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Heuristic: does this reply look like a tool call we failed to parse,
 * rather than a plain answer? Catches the explicit `tool_code` fence, a
 * python-ish `print(call())`, and any known tool name immediately invoked
 * (`fetch_url(`). Used to avoid printing raw call scaffolding as the
 * user-facing answer when parsing came up empty.
 */
function looksLikeUnparsedToolCall(
  reply: string,
  tools: readonly AgentTool[],
): boolean {
  if (/```tool_code/i.test(reply)) return true;
  if (/\bprint\s*\(\s*\w/.test(reply)) return true;
  return tools.some((t) =>
    new RegExp(`(^|[^\\w.])${escapeRegExp(t.name)}\\s*\\(`).test(reply),
  );
}

// ─── URL safety net (parity with createAgent.ts) ──────────────────────────

const NOTE_NOT_FETCHED =
  "> ⚠ The agent answered without fetching the page, so it had no real content to work from. This answer is likely fabricated — verify in the transcript that `fetch_url` was actually called.\n\n";
const NOTE_FETCH_FAILED =
  "> ⚠ The page couldn't be fetched (often CORS on the browser), so the agent had no real content to work from. This answer may be fabricated — verify the tool calls in the transcript.\n\n";

/** Extract HTTP(S) URLs from free-text input. Conservative on purpose. */
function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>'"`]+/g);
  return matches ? Array.from(new Set(matches)) : [];
}

/** Normalize a URL for matching (trailing slash / trailing punctuation). */
function normUrl(u: string): string {
  return u.trim().replace(/[).,;]+$/, "").replace(/\/+$/, "");
}

/**
 * Whether a fetch-tool call actually retrieved the page. A CORS / network
 * failure does NOT throw — `fetch_url` returns `{ status: 0, error }` — so
 * "no record-level error" is not enough; we must inspect the output. A
 * fetch counts as succeeded only when it didn't throw, reported no
 * `error` field, and came back with a 2xx status.
 */
function fetchDidSucceed(r: AgentToolCallRecord): boolean {
  if (r.error) return false;
  const out = r.output as { status?: number; error?: string } | undefined;
  if (!out || out.error) return false;
  if (typeof out.status === "number" && (out.status < 200 || out.status >= 300)) {
    return false;
  }
  return true;
}

/** First tool whose input schema declares a `url` property. */
function findUrlFetchingTool(
  tools: readonly AgentTool[],
): AgentTool | undefined {
  return tools.find((t) => {
    const props = (t.inputSchema?.properties ?? {}) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(props, "url");
  });
}

/**
 * Prepend an honest disclaimer when a URL was given, a fetch tool was
 * available, but no fetch SUCCEEDED — never-attempted vs attempted-and-
 * failed get different wording. Deterministic; zero extra inference.
 */
function maybeFlagUnverifiedUrl(
  finalText: string,
  ctx: {
    hasFetchTool: boolean;
    totalUrls: number;
    /** User URLs that never fetched successfully. */
    unfetched: readonly string[];
    /** Whether any fetch was attempted at all (for single-URL wording). */
    anyTried: boolean;
  },
): string {
  if (!ctx.hasFetchTool || ctx.totalUrls === 0 || ctx.unfetched.length === 0) {
    return finalText;
  }
  if (!finalText.trim()) return finalText;

  // Single URL keeps the original two-way wording (never-fetched vs
  // attempted-and-failed). Multiple URLs name the specific ones that
  // didn't come back, so the user knows which parts to distrust.
  let note: string;
  if (ctx.totalUrls === 1) {
    note = ctx.anyTried ? NOTE_FETCH_FAILED : NOTE_NOT_FETCHED;
  } else {
    const list = ctx.unfetched.join(", ");
    note =
      `> ⚠ ${ctx.unfetched.length} of ${ctx.totalUrls} URLs couldn't be fetched ` +
      `(often CORS on the browser): ${list}. Anything about ` +
      `${ctx.unfetched.length === 1 ? "it" : "them"} may be fabricated — ` +
      `verify the \`fetch_url\` results in the transcript.\n\n`;
  }
  return `${note}${finalText}`;
}

/**
 * The reasoning the model wrote BEFORE its `tool_code` block, if any —
 * used as a synthesized `thought`. Returns "" when the reply opens
 * straight into the call (the common case) or has no fence.
 */
function leadingProse(reply: string): string {
  const fence = reply.indexOf("```");
  if (fence <= 0) return "";
  const prose = reply.slice(0, fence).trim();
  // Guard against a stray short token; only treat a real sentence as a
  // thought, and keep it bounded so a runaway preface can't flood the UI.
  if (prose.length < 4) return "";
  return prose.length > 600 ? `${prose.slice(0, 599)}…` : prose;
}

function makeAbortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

function isAbort(err: unknown): boolean {
  return (err as Error)?.name === "AbortError";
}

function composeSignals(
  primary: AbortSignal,
  external: AbortSignal | undefined,
): AbortSignal {
  if (!external) return primary;
  if (primary.aborted || external.aborted) {
    const c = new AbortController();
    c.abort();
    return c.signal;
  }
  const c = new AbortController();
  const onAbort = () => c.abort();
  primary.addEventListener("abort", onAbort, { once: true });
  external.addEventListener("abort", onAbort, { once: true });
  return c.signal;
}

function makeUnavailableAgent(tools: readonly AgentTool[]): Agent {
  const fallback: AgentRunResult = {
    text: "",
    steps: [],
    stopReason: "unavailable",
  };
  return {
    get tools() {
      return tools;
    },
    async run() {
      return fallback;
    },
    runStreaming() {
      return streamFromResult(fallback, {
        type: "done",
        reason: "unavailable",
        text: "",
      });
    },
    abort() {},
    newSession() {},
    destroy() {},
  };
}
