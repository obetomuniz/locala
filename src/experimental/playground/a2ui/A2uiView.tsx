import type {
  A2uiComponentNode,
  A2uiSnapshot,
  A2uiSurfaceSnapshot,
} from "../../agent/a2ui";

function literalString(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const lit = (value as { literalString?: string }).literalString;
  return typeof lit === "string" ? lit : undefined;
}

function childIds(children: unknown): string[] {
  if (!children || typeof children !== "object") return [];
  const explicit = (children as { explicitList?: string[] }).explicitList;
  return Array.isArray(explicit) ? explicit : [];
}

function textRole(id: string): "title" | "subtitle" | "body" {
  if (id === "title") return "title";
  if (id === "subtitle") return "subtitle";
  return "body";
}

interface MetricItem {
  label: string;
  value: number;
  max?: number;
  unit?: string;
}

function parseMetricItems(raw: unknown): MetricItem[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (it): it is MetricItem =>
        !!it &&
        typeof it === "object" &&
        typeof (it as { label?: unknown }).label === "string" &&
        typeof (it as { value?: unknown }).value === "number",
    )
    .map((it) => ({
      label: String(it.label),
      value: it.value,
      max: typeof it.max === "number" ? it.max : undefined,
      unit: typeof it.unit === "string" ? it.unit : undefined,
    }));
}

function formatMetricValue(value: number, unit?: string): string {
  const base =
    Number.isInteger(value) || Math.abs(value) >= 10
      ? String(value)
      : value.toFixed(1);
  return unit ? `${base}${unit}` : base;
}

function renderNode(
  id: string,
  surface: A2uiSurfaceSnapshot,
  data: Record<string, unknown>,
): JSX.Element | null {
  const node = surface.components[id];
  if (!node) return null;

  const entries = Object.entries(node.component);
  if (entries.length === 0) return null;
  const [type, props] = entries[0];
  const p = (props ?? {}) as Record<string, unknown>;

  switch (type) {
    case "Text": {
      const text =
        literalString(p.text) ??
        (typeof p.text === "string" ? p.text : id);
      const role = textRole(id);
      if (role === "title") {
        return <h2 className="agentp__a2ui-heading">{text}</h2>;
      }
      if (role === "subtitle") {
        return <p className="agentp__a2ui-lead">{text}</p>;
      }
      return <p className="agentp__a2ui-text">{text}</p>;
    }
    case "Divider":
      return <hr className="agentp__a2ui-divider" />;
    case "Button": {
      const label =
        literalString(p.label) ??
        literalString(p.text) ??
        "Button";
      return (
        <div className="agentp__a2ui-actions">
          <button
            type="button"
            className="agentp__a2ui-btn agentp__a2ui-btn--primary"
          >
            {label}
          </button>
        </div>
      );
    }
    case "TextField": {
      const label = literalString(p.label) ?? "Field";
      const placeholder = literalString(p.placeholder) ?? "";
      return (
        <label className="agentp__a2ui-field">
          <span className="agentp__a2ui-field-label">{label}</span>
          <input
            type="text"
            className="agentp__a2ui-field-input"
            readOnly
            placeholder={placeholder}
            aria-label={label}
          />
        </label>
      );
    }
    case "Column": {
      const ids = childIds(p.children);
      const layoutClass =
        id === "card_body" ? "agentp__a2ui-stack" : "agentp__a2ui-column";
      return (
        <div className={layoutClass}>
          {ids.map((cid) => (
            <div key={cid} className="agentp__a2ui-slot">
              {renderNode(cid, surface, data)}
            </div>
          ))}
        </div>
      );
    }
    case "Row": {
      const ids = childIds(p.children);
      return (
        <div className="agentp__a2ui-row">
          {ids.map((cid) => (
            <div key={cid} className="agentp__a2ui-slot">
              {renderNode(cid, surface, data)}
            </div>
          ))}
        </div>
      );
    }
    case "Card": {
      const child = typeof p.child === "string" ? p.child : undefined;
      return (
        <article className="agentp__a2ui-card">
          {child ? renderNode(child, surface, data) : null}
        </article>
      );
    }
    case "List": {
      const ids = childIds(p.children);
      return (
        <ul className="agentp__a2ui-list">
          {ids.map((cid) => (
            <li key={cid}>{renderNode(cid, surface, data)}</li>
          ))}
        </ul>
      );
    }
    case "Chart": {
      const items = parseMetricItems(p);
      if (items.length === 0) return null;
      const maxVal = Math.max(
        ...items.map((it) => it.max ?? it.value),
        1,
      );
      return (
        <div
          className="agentp__a2ui-chart"
          role="img"
          aria-label="Bar chart"
        >
          <ul className="agentp__a2ui-chart-bars">
            {items.map((it) => {
              const pct = Math.min(100, (it.value / maxVal) * 100);
              return (
                <li key={it.label} className="agentp__a2ui-chart-bar">
                  <div className="agentp__a2ui-chart-bar-track">
                    <div
                      className="agentp__a2ui-chart-bar-fill"
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="agentp__a2ui-chart-bar-value">
                    {formatMetricValue(it.value, it.unit)}
                  </span>
                  <span className="agentp__a2ui-chart-bar-label">
                    {it.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    case "StatRow": {
      const items = parseMetricItems(p);
      if (items.length === 0) return null;
      return (
        <div className="agentp__a2ui-stats" role="group" aria-label="Metrics">
          {items.map((it) => (
            <div key={it.label} className="agentp__a2ui-stat">
              <span className="agentp__a2ui-stat-value">
                {formatMetricValue(it.value, it.unit)}
              </span>
              <span className="agentp__a2ui-stat-label">{it.label}</span>
            </div>
          ))}
        </div>
      );
    }
    default:
      return (
        <div className="agentp__a2ui-unknown" title={type}>
          [{type}]
        </div>
      );
  }
}

interface Props {
  snapshot: A2uiSnapshot;
  streaming?: boolean;
}

export function A2uiView({ snapshot, streaming }: Props) {
  const surfaces = Object.values(snapshot).filter((s) => s.ready && s.rootId);
  if (surfaces.length === 0) {
    return (
      <p
        className={`agentp__a2ui-placeholder${streaming ? " agentp__a2ui-placeholder--live" : ""}`}
      >
        {streaming
          ? "Building generative UI…"
          : "No A2UI surface ready (waiting for beginRendering)."}
      </p>
    );
  }

  return (
    <div className="agentp__a2ui-root">
      {surfaces.map((surface) => (
        <section
          key={surface.surfaceId}
          className="agentp__a2ui-surface"
          data-surface={surface.surfaceId}
          aria-label="Generated UI"
        >
          {surface.rootId
            ? renderNode(surface.rootId, surface, surface.dataModel)
            : null}
        </section>
      ))}
    </div>
  );
}

export type { A2uiComponentNode };
