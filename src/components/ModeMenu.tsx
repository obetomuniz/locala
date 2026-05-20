import { useEffect, useRef, useState } from "react";
import { MODES, type Mode } from "../lib/agents";

interface Props {
  mode: Mode;
  disabled?: boolean;
  onChange: (modeId: string) => void;
}

function ModeIcon({ id }: { id: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "concise":
      return (
        <svg {...common}>
          <path d="M3 5.5h10M3 8h7M3 10.5h4" />
        </svg>
      );
    case "explorer":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="m10.2 5.8-1.6 3-3 1.6 1.6-3z" />
        </svg>
      );
    case "coder":
      return (
        <svg {...common}>
          <path d="m5 5-3 3 3 3M11 5l3 3-3 3M9.5 4l-3 8" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
  }
}

function ChevronIcon() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 4.5 3 3 3-3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

export function ModeMenu({ mode, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="mode-menu" ref={wrapperRef}>
      <button
        type="button"
        className="mode-menu__trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Mode: ${mode.name}. Open mode menu.`}
        title={`Mode: ${mode.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mode-menu__trigger-icon" aria-hidden="true">
          <ModeIcon id={mode.id} />
        </span>
        <span className="mode-menu__trigger-name">{mode.name}</span>
        <span className="mode-menu__trigger-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div className="mode-menu__popover" role="menu">
          <div className="mode-menu__section">Mode</div>
          {MODES.map((m) => {
            const active = m.id === mode.id;
            return (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`mode-menu__item${active ? " is-active" : ""}`}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
              >
                <span className="mode-menu__icon">
                  <ModeIcon id={m.id} />
                </span>
                <span className="mode-menu__text">
                  <span className="mode-menu__name">{m.name}</span>
                  <span className="mode-menu__desc">{m.description}</span>
                </span>
                {active && (
                  <span className="mode-menu__check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
