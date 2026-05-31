import type { AgentTool } from "../agent/types";

interface Props {
  tools: readonly AgentTool[];
}

export function ToolList({ tools }: Props) {
  if (tools.length === 0) {
    return (
      <div className="agentp__empty">
        This preset has no tools — the planner can still respond in
        natural language using the Prompt API alone.
      </div>
    );
  }

  return (
    <ul className="agentp__tools">
      {tools.map((tool) => {
        const tags = [
          tool.readOnly ? "read-only" : null,
          tool.destructive ? "destructive" : null,
        ].filter(Boolean) as string[];
        return (
          <li key={tool.name} className="agentp__tool">
            <div className="agentp__tool-head">
              <code className="agentp__tool-name">{tool.name}</code>
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={`agentp__tool-tag agentp__tool-tag--${tag}`}
                >
                  {tag}
                </span>
              ))}
            </div>
            <p className="agentp__tool-desc">{tool.description}</p>
          </li>
        );
      })}
    </ul>
  );
}
