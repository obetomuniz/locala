export interface TranscriptToolFrame {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  progress: unknown[];
  output?: unknown;
  error?: { message: string; name?: string };
  durationMs?: number;
  pending: boolean;
}

export type ToolRendererId = "default" | "minimal";

type ToolRendererProps = {
  tool: TranscriptToolFrame;
};

type ToolRendererComponent = (props: ToolRendererProps) => JSX.Element;

const renderers: Record<ToolRendererId, ToolRendererComponent> = {
  default: DefaultToolRenderer,
  minimal: MinimalToolRenderer,
};

export function resolveToolRenderer(id?: ToolRendererId): ToolRendererComponent {
  return id ? renderers[id] : renderers.default;
}

function resolveToolCardStatus(
  tool: TranscriptToolFrame,
): "calling" | "ok" | "error" | "warn" {
  if (tool.pending) return "calling";
  if (tool.error) return "error";
  if (
    tool.name === "summarize_text" &&
    tool.output &&
    typeof tool.output === "object" &&
    !(tool.output as { summary?: string }).summary?.trim()
  ) {
    return "warn";
  }
  return "ok";
}

function DefaultToolRenderer({ tool }: ToolRendererProps) {
  const status = resolveToolCardStatus(tool);

  return (
    <li className={`agentp__tool-card agentp__tool-card--${status}`}>
      <header className="agentp__tool-card-head">
        <code className="agentp__tool-card-name">{tool.name}</code>
        <span
          className={`agentp__tool-card-status agentp__tool-card-status--${status}`}
        >
          {status === "calling" && "calling..."}
          {status === "ok" && `${Math.round(tool.durationMs ?? 0)}ms`}
          {status === "warn" && "unavailable"}
          {status === "error" && "error"}
        </span>
      </header>

      {tool.progress.length > 0 && (
        <ul className="agentp__tool-progress">
          {tool.progress.map((p, i) => (
            <li key={i} className="agentp__tool-progress-item">
              <span className="agentp__tool-progress-dot" />
              <code>{summarizeJson(p)}</code>
            </li>
          ))}
        </ul>
      )}

      <details className="agentp__tool-card-details">
        <summary className="agentp__tool-card-summary">
          input · {summarizeJson(tool.input)}
        </summary>
        <pre className="agentp__tool-card-json">
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      </details>
      {!tool.pending && (
        <details className="agentp__tool-card-details" open={!!tool.error}>
          <summary className="agentp__tool-card-summary">
            {tool.error
              ? `error · ${truncate(tool.error.message, 80)}`
              : status === "warn"
                ? "summarizer unavailable · answered below"
                : `output · ${summarizeJson(tool.output)}`}
          </summary>
          <pre className="agentp__tool-card-json">
            {tool.error ? formatError(tool.error) : JSON.stringify(tool.output, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

function MinimalToolRenderer({ tool }: ToolRendererProps) {
  const status = resolveToolCardStatus(tool);
  const statusText =
    status === "calling"
      ? "running"
      : status === "error"
        ? "error"
        : status === "warn"
          ? "unavailable"
          : `${Math.round(tool.durationMs ?? 0)}ms`;
  const outputLine = tool.error
    ? `error: ${truncate(tool.error.message, 120)}`
    : tool.pending
      ? tool.progress.length > 0
        ? `progress: ${truncate(summarizeJson(tool.progress[tool.progress.length - 1]), 120)}`
        : "waiting for output..."
      : `output: ${truncate(summarizeJson(tool.output), 120)}`;

  return (
    <li className={`agentp__tool-item agentp__tool-item--${status}`}>
      <div className="agentp__tool-item-head">
        <code className="agentp__tool-item-name">{tool.name}</code>
        <span className="agentp__tool-item-status">{statusText}</span>
      </div>
      <div className="agentp__tool-item-body">
        <code>{outputLine}</code>
      </div>
    </li>
  );
}

function summarizeJson(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return `"${truncate(value, 40)}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return truncate(JSON.stringify(value), 60);
  } catch {
    return "[unserializable]";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}...`;
}

function formatError(err: { message: string; name?: string }): string {
  if (err.name) return `${err.name}: ${err.message}`;
  return err.message;
}

