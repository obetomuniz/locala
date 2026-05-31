import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { isAvailable as isPromptAvailable } from "@web-ai-sdk/prompt";
import { isAvailable as isWebMCPAvailable } from "@web-ai-sdk/webmcp";
import { isAvailable as isSummarizerAvailable } from "@web-ai-sdk/summarizer";
import { useAgent } from "../agent/react";
import { PRESETS } from "./presets";
import { EventLog } from "./EventLog";
import { ToolList } from "./ToolList";
import { Transcript } from "./Transcript";
import { useAutoscroll } from "./useAutoscroll";
import { useExamples } from "./useExamples";
import "./styles.css";

interface Props {
  onClose: () => void;
}

const DEFAULT_PRESET_ID = "platform";

export function AgentPlayground({ onClose }: Props) {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const preset = useMemo(
    () => PRESETS.find((p) => p.id === presetId) ?? PRESETS[0],
    [presetId],
  );

  /**
   * `useAgent` reference-compares `tools` to decide whether to rebuild
   * the agent. Wrapping in `useMemo(..., [preset])` makes the agent
   * recreate only when the user picks a different preset.
   */
  const tools = useMemo(() => preset.tools, [preset]);

  const {
    status,
    text,
    liveThought,
    events,
    steps,
    stopReason,
    error,
    run,
    abort,
    reset,
  } = useAgent({
    systemPrompt: preset.systemPrompt,
    tools,
    maxSteps: 6,
    temperature: 0.3,
    // Chrome warns (and degrades output quality) when no output language
    // is set on a LanguageModel request. Pin English for the planner.
    language: "en",
  });

  const {
    examples,
    regenerate: regenerateExamples,
    generating: generatingExamples,
    error: examplesError,
    canRegenerate: canRegenerateExamples,
  } = useExamples(preset);

  const [draft, setDraft] = useState(preset.examples[0] ?? "");

  // Transcript and event log both autoscroll while the user is near
  // the bottom; yield as soon as they scroll up to inspect, resume on
  // scroll-back. `text + events.length` covers both streamed deltas
  // and structured event arrivals.
  const transcriptRef = useRef<HTMLDivElement>(null);
  useAutoscroll(transcriptRef, [text, events.length, liveThought?.text]);

  // Chrome's `promptStreaming` honours abort signals at chunk boundaries,
  // so abort propagation can lag ~100-500ms. Tracking a local "stopping"
  // state gives the Stop button immediate visual feedback (label flips to
  // "Stopping…", click disabled) instead of silently sitting there while
  // the user wonders if their click registered.
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (status !== "planning" && status !== "tool_calling" && status !== "streaming") {
      setStopping(false);
    }
  }, [status]);
  const handleStop = () => {
    setStopping(true);
    abort();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (status === "planning" || status === "tool_calling" || status === "streaming")
      return;
    if (!draft.trim()) return;
    void run(draft.trim());
  };

  const busy =
    status === "planning" ||
    status === "tool_calling" ||
    status === "streaming";

  const promptOn = isPromptAvailable();
  const summarizerOn = isSummarizerAvailable();
  const webmcpOn = isWebMCPAvailable();

  return (
    <div className="agentp" role="dialog" aria-modal="true">
      <aside className="agentp__sidebar">
        <header className="agentp__sidebar-header">
          <div className="agentp__brand-stack">
            <div className="agentp__brand">Agent</div>
            <div className="agentp__brand-sub">experimental</div>
          </div>
          <button
            type="button"
            className="agentp__close agentp__close--mobile"
            aria-label="Close playground"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="agentp__sidebar-body">
          <section className="agentp__section">
            <div className="agentp__section-title">Preset</div>
            <div className="agentp__presets">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`agentp__preset${
                    p.id === presetId ? " agentp__preset--active" : ""
                  }`}
                  onClick={() => {
                    setPresetId(p.id);
                    reset();
                    setDraft(p.examples[0] ?? "");
                  }}
                >
                  <span className="agentp__preset-name">{p.name}</span>
                  <span className="agentp__preset-desc">{p.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="agentp__section">
            <div className="agentp__section-title">Tools</div>
            <ToolList tools={tools} />
          </section>

          <section className="agentp__section">
            <div className="agentp__section-title">System prompt</div>
            <pre className="agentp__system">{preset.systemPrompt}</pre>
          </section>
        </div>
      </aside>

      <main className="agentp__main">
        <header className="agentp__main-header">
          <div className="agentp__title-block">
            <div className="agentp__title">Agent Playground</div>
            <div className="agentp__subtitle">{preset.name}</div>
          </div>
          <button
            type="button"
            className="agentp__new-session"
            onClick={() => window.location.reload()}
            disabled={busy}
            title="Reload for a fresh model session. Each run already clones a clean conversation from a warm base session, so this is only needed to reset Chrome's on-device model if it gets slow under heavy use."
          >
            ↺ Reset session
          </button>
        </header>

        <div className="agentp__main-body">
          <div className="agentp__col-row">
            <div className="agentp__col-row-title">Transcript</div>
            <span className="agentp__status">
              {status}
              {stopReason && status !== "planning" && status !== "tool_calling"
                ? ` · ${stopReason}`
                : ""}
            </span>
          </div>
          <section className="agentp__panel agentp__panel--transcript">
            <div ref={transcriptRef} className="agentp__answer">
              {!promptOn && (
                <div className="agentp__banner">
                  Prompt API is unavailable. Enable Chrome's flag at{" "}
                  <code>chrome://flags/#prompt-api-for-gemini-nano</code> and
                  reload to use the agent.
                </div>
              )}
              <Transcript
                events={events}
                text={text}
                liveThought={liveThought}
                stopReason={stopReason}
                busy={busy}
              />
              {error && (
                <div className="agentp__banner agentp__banner--error">
                  {error.name}: {error.message}
                </div>
              )}
            </div>
          </section>

          <form className="agentp__composer" onSubmit={submit}>
            <textarea
              className="agentp__input"
              placeholder={
                promptOn
                  ? "Ask the agent something. Shift+Enter for newline."
                  : "Prompt API unavailable — enable it in chrome://flags first."
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!promptOn}
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(e as unknown as FormEvent);
                }
              }}
            />
            <div className="agentp__composer-row">
              <div
                className="agentp__examples"
                title={
                  examplesError
                    ? `Couldn't generate fresh examples: ${examplesError.message}`
                    : undefined
                }
              >
                {examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="agentp__example"
                    onClick={() => setDraft(ex)}
                    disabled={busy}
                  >
                    {truncate(ex, 60)}
                  </button>
                ))}
                {canRegenerateExamples && (
                  <button
                    type="button"
                    className="agentp__example agentp__example--regenerate"
                    onClick={regenerateExamples}
                    disabled={busy || generatingExamples}
                    title="Generate fresh examples on-device with the Prompt API"
                  >
                    {generatingExamples ? "generating…" : "↻ new examples"}
                  </button>
                )}
              </div>
              <div className="agentp__composer-actions">
                {busy ? (
                  <button
                    type="button"
                    className="agentp__btn agentp__btn--stop"
                    onClick={handleStop}
                    disabled={stopping}
                  >
                    {stopping ? "Stopping…" : "Stop"}
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="agentp__btn agentp__btn--send"
                    disabled={!promptOn || !draft.trim()}
                  >
                    Run
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </main>

      <section className="agentp__workspace">
        <header className="agentp__workspace-header">
          <div className="agentp__workspace-title">
            Workspace
            <span className="agentp__workspace-count">
              · {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            className="agentp__close"
            aria-label="Close playground"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="agentp__workspace-body">
          <div className="agentp__col-row">
            <div className="agentp__chips">
              <Chip on={promptOn} label="prompt" />
              <Chip on={summarizerOn} label="summarizer" />
              <Chip on={webmcpOn} label="webmcp" />
            </div>
          </div>
          <div className="agentp__workspace-pane">
            <div className="agentp__pane-title">
              <span>Events</span>
              <span className="agentp__pane-meta">
                {events.length} event{events.length === 1 ? "" : "s"}
              </span>
            </div>
            <EventLog events={events} />
          </div>
          <div className="agentp__workspace-pane">
            <div className="agentp__pane-title">Hints</div>
            <ul className="agentp__hints">
              <li>
                The <strong>Transcript</strong> shows thoughts, tool calls
                with live progress, and the streaming answer.
              </li>
              <li>
                <strong>Events</strong> is the structural feed. Token-level
                deltas are filtered out as noise.
              </li>
              <li>
                <code>↻ new examples</code> regenerates prompt suggestions
                on-device via a single constrained call.
              </li>
              <li>
                Stop reason <code>budget_exhausted</code> means the planner
                ran out of steps. Raise <code>maxSteps</code>.
              </li>
              <li>
                <code>fetch_url</code> is bound by the browser's same-origin
                policy. CORS-enabled origins (GitHub API, public JSON) work;
                arbitrary blog / news URLs fail by browser design.
              </li>
              <li>
                On-device models <strong>confabulate URL contents</strong>{" "}
                when they can't actually read a page (e.g. a CORS-blocked
                blog). When a URL was given but no fetch succeeded, the
                answer is flagged as unverified — a deterministic check, not
                a guess. Verify against the <code>fetch_url</code> result in
                the transcript.
              </li>
              <li>
                Each run <strong>clones a fresh conversation</strong> from a
                warm base session (Chrome's official <code>clone()</code>{" "}
                pattern, <code>@web-ai-sdk/prompt</code> 0.5+) — so runs
                don't reuse prior answers, the system prompt isn't
                re-parsed, and the model stays loaded between runs.{" "}
                <code>↺ Reset session</code> reloads only if the model gets
                slow under heavy use.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`agentp__chip${on ? " agentp__chip--on" : " agentp__chip--off"}`}
    >
      {label} {on ? "on" : "off"}
    </span>
  );
}

function truncate(s: string, n = 60): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
