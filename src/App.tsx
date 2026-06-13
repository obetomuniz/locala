import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { isAvailable as isPromptAvailable } from "@web-ai-sdk/prompt";
import { isAvailable as isSummarizerAvailable } from "@web-ai-sdk/summarizer";
import { isAvailable as isWebMCPAvailable } from "@web-ai-sdk/webmcp";
import { useAgent } from "./experimental/agent/react";
import { MultiTurnTranscript } from "./experimental/playground/MultiTurnTranscript";
import { PRESETS } from "./experimental/playground/presets";
import { ToolList } from "./experimental/playground/ToolList";
import { useExamples } from "./experimental/playground/useExamples";
import { useAgentThreads } from "./lib/useAgentThreads";
import { useStickToBottom } from "./lib/useStickToBottom";
import { useWebMCPTools } from "./lib/useWebMCPTools";
import type { ActivityEvent } from "./lib/types";
import "./experimental/playground/styles.css";

const MAX_ACTIVITY = 50;

export function App() {
  const { threads, activeThread, activeSkill, ops } = useAgentThreads();
  const [draft, setDraft] = useState("");
  const [infoTab, setInfoTab] = useState<"activity" | "hints">("hints");
  const [eventsLog, setEventsLog] = useState<ActivityEvent[]>([]);
  const promptOn = useMemo(() => isPromptAvailable(), []);
  const summarizerOn = useMemo(() => isSummarizerAvailable(), []);
  const webmcpOn = useMemo(() => isWebMCPAvailable(), []);

  const pushActivity = useCallback(
    (event: Omit<ActivityEvent, "id" | "ts">) => {
      setEventsLog((prev) =>
        [{ id: crypto.randomUUID(), ts: Date.now(), ...event }, ...prev].slice(
          0,
          MAX_ACTIVITY,
        ),
      );
    },
    [],
  );

  const tools = useMemo(() => activeSkill.tools, [activeSkill]);
  const {
    status,
    text,
    a2uiSnapshot,
    liveThought,
    events,
    steps,
    stopReason,
    error,
    run,
    abort,
    newSession,
    previewA2ui,
  } = useAgent({
    systemPrompt: activeSkill.systemPrompt,
    tools,
    maxSteps: 6,
    sessionMode: "thread",
    samplingMode: "predictable",
    language: "en",
    a2ui: activeSkill.a2ui,
    onTurnComplete: (turn) => {
      ops.appendTurn(activeThread.id, turn);
      pushActivity({
        kind: "chat_response",
        message: "reply",
        detail: activeThread.name,
      });
    },
  });

  const {
    examples,
    regenerate: regenerateExamples,
    generating: generatingExamples,
    error: examplesError,
    canRegenerate: canRegenerateExamples,
  } = useExamples(activeSkill);

  const busy =
    status === "planning" ||
    status === "tool_calling" ||
    status === "streaming";

  const send = useCallback(
    async (textToSend: string) => {
      const trimmed = textToSend.trim();
      if (!trimmed || busy) return;
      pushActivity({
        kind: "chat_send",
        message: "send",
        detail: trimmed,
      });
      await run(trimmed);
    },
    [busy, pushActivity, run],
  );

  const clear = useCallback(() => {
    ops.clearTurns(activeThread.id);
    newSession();
    pushActivity({
      kind: "chat_clear",
      message: "clear thread",
      detail: activeThread.name,
    });
  }, [activeThread.id, activeThread.name, newSession, ops, pushActivity]);

  const { available: webmcpAvailable } = useWebMCPTools({
    threads,
    activeThread,
    ops,
    send,
    clear,
    newSession,
    pushActivity,
  });

  useEffect(() => {
    pushActivity({
      kind: "info",
      message: "ready",
      detail: `prompt:${promptOn ? "on" : "off"} · webmcp:${webmcpAvailable ? "on" : "off"} · summarizer:${summarizerOn ? "on" : "off"}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const { isPinned, scrollToBottom } = useStickToBottom(transcriptRef, [
    activeThread.turns.length,
    text,
    events.length,
    liveThought?.text,
  ]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    void send(draft);
    setDraft("");
  };

  const createThread = (skillId = activeSkill.id) => {
    const thread = ops.create(skillId);
    newSession();
    pushActivity({
      kind: "chat_switch",
      message: "new thread",
      detail: thread.name,
    });
  };

  const selectThread = (id: string) => {
    if (id === activeThread.id) return;
    ops.select(id);
    newSession();
    const thread = threads.find((candidate) => candidate.id === id);
    pushActivity({
      kind: "chat_switch",
      message: "thread",
      detail: thread?.name ?? id,
    });
  };

  const setSkill = (skillId: string) => {
    const skill = PRESETS.find((preset) => preset.id === skillId) ?? PRESETS[0];
    if (activeThread.turns.length === 0) {
      ops.setSkill(activeThread.id, skill.id);
      newSession();
    } else {
      createThread(skill.id);
    }
    setDraft("");
    pushActivity({ kind: "info", message: "skill", detail: skill.name });
  };

  return (
    <div className="agentp app--agent">
      <aside className="agentp__sidebar">
        <header className="agentp__sidebar-header">
          <div className="agentp__brand-stack">
            <div className="agentp__brand">locala</div>
            <div className="agentp__brand-sub">on-device agent</div>
          </div>
        </header>

        <div className="agentp__sidebar-body">
          <section className="agentp__section">
            <div className="agentp__section-title">Threads</div>
            <button
              type="button"
              className="agentp__new-session agentp__new-session--wide"
              onClick={() => createThread()}
              disabled={busy}
            >
              + New thread
            </button>
            <div className="agentp__presets">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={`agentp__preset${
                    thread.id === activeThread.id ? " agentp__preset--active" : ""
                  }`}
                  onClick={() => selectThread(thread.id)}
                >
                  <span className="agentp__preset-name">{thread.name}</span>
                  <span className="agentp__preset-desc">
                    {findSkillName(thread.skillId)} · {thread.turns.length} turn
                    {thread.turns.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="agentp__section">
            <div className="agentp__section-title">Skill</div>
            <div className="agentp__presets">
              {PRESETS.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  data-preset-id={skill.id}
                  className={`agentp__preset${
                    skill.id === activeSkill.id ? " agentp__preset--active" : ""
                  }`}
                  onClick={() => setSkill(skill.id)}
                  disabled={busy}
                >
                  <span className="agentp__preset-name">{skill.name}</span>
                  <span className="agentp__preset-desc">{skill.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="agentp__section">
            <div className="agentp__section-title">Tools</div>
            <ToolList tools={tools} />
          </section>
        </div>
      </aside>

      <main className="agentp__main">
        <header className="agentp__main-header">
          <div className="agentp__title-block">
            <div className="agentp__title">{activeThread.name}</div>
            <div className="agentp__subtitle">{activeSkill.name}</div>
          </div>
          <div className="agentp__header-actions">
            <button
              type="button"
              className="agentp__new-session"
              onClick={() => {
                newSession();
                pushActivity({
                  kind: "info",
                  message: "reset session",
                  detail: activeThread.name,
                });
              }}
              disabled={busy}
              title="Reset the native model session for this thread. The visible history stays, but the model may not recall it until history re-seeding is added."
            >
              Reset session
            </button>
            <button
              type="button"
              className="agentp__new-session"
              onClick={clear}
              disabled={busy || activeThread.turns.length === 0}
            >
              Clear
            </button>
          </div>
        </header>

        <div className="agentp__main-body">
          <div className="agentp__col-row">
            <div className="agentp__col-row-title">Transcript</div>
            <span className="agentp__status">
              {promptOn ? status : "unavailable"}
              {stopReason &&
              stopReason !== status &&
              status !== "planning" &&
              status !== "tool_calling"
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
              <MultiTurnTranscript
                turns={activeThread.turns}
                events={events}
                text={text}
                a2uiSnapshot={a2uiSnapshot}
                liveThought={liveThought}
                stopReason={stopReason}
                busy={busy}
                transcriptRendererId={activeSkill.transcriptRendererId}
                toolRendererId={activeSkill.toolRendererId}
                a2uiEnabled={activeSkill.a2ui?.enabled}
              />
              {error && (
                <div className="agentp__banner agentp__banner--error">
                  {error.name}: {error.message}
                </div>
              )}
            </div>
            {!isPinned && (
              <button
                type="button"
                className="agentp__jump"
                onClick={() => scrollToBottom()}
                aria-label="Scroll to latest"
              >
                <span aria-hidden="true">↓</span> Latest
              </button>
            )}
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
                {(activeSkill.a2uiStaticDemos ?? []).map((demo) => (
                  <button
                    key={demo.id}
                    type="button"
                    className="agentp__example agentp__example--static"
                    onClick={() => previewA2ui(demo.messages)}
                    disabled={busy}
                    title="Instant preview (no model call)"
                  >
                    {demo.label}
                  </button>
                ))}
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
                    {generatingExamples ? "generating..." : "new examples"}
                  </button>
                )}
              </div>
              <div className="agentp__composer-actions">
                {busy ? (
                  <button
                    type="button"
                    className="agentp__btn agentp__btn--stop"
                    onClick={() => {
                      abort();
                      pushActivity({
                        kind: "chat_abort",
                        message: "abort",
                        detail: activeThread.name,
                      });
                    }}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="agentp__btn agentp__btn--send"
                    data-testid="agent-run"
                    disabled={!promptOn || !draft.trim()}
                  >
                    Send
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
            <div className="agentp__pane-title agentp__pane-tabs">
              <button
                type="button"
                className={`agentp__pane-tab${
                  infoTab === "hints" ? " agentp__pane-tab--active" : ""
                }`}
                onClick={() => setInfoTab("hints")}
              >
                Hints
              </button>
              <button
                type="button"
                className={`agentp__pane-tab${
                  infoTab === "activity" ? " agentp__pane-tab--active" : ""
                }`}
                onClick={() => setInfoTab("activity")}
              >
                Activity
              </button>
            </div>
            {infoTab === "activity" ? (
              <ActivityList events={eventsLog} />
            ) : (
              <ul className="agentp__hints">
                <li>
                  Threads persist locally in <code>locala:v3:agent-threads</code>.
                </li>
                <li>
                  Skills bundle prompts, tools, examples, and renderers.
                </li>
                <li>
                  WebMCP tools operate on agent threads:{" "}
                  <code>list_threads</code>, <code>new_thread</code>,{" "}
                  <code>switch_thread</code>, and <code>send_message</code>.
                </li>
              </ul>
            )}
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

function ActivityList({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <div className="agentp__empty">Activity appears here.</div>;
  }
  return (
    <ul className="activity">
      {events.map((event) => (
        <li key={event.id} className={`activity__item activity__item--${event.kind}`}>
          <span className="activity__time">{fmtTime(event.ts)}</span>
          <span className="activity__kind">{event.kind.replace("chat_", "")}</span>
          <span className="activity__main">
            <span className="activity__message">{event.message}</span>
            {event.detail && <span className="activity__detail">{event.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function findSkillName(skillId: string): string {
  return PRESETS.find((preset) => preset.id === skillId)?.name ?? PRESETS[0].name;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function truncate(s: string, n = 60): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}...`;
}
