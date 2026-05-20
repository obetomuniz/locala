import { MODES, type Mode } from "../lib/agents";

interface Props {
  mode: Mode;
  disabled?: boolean;
  onChange: (modeId: string) => void;
}

export function ModePicker({ mode, disabled, onChange }: Props) {
  return (
    <label className="mode-picker" title={mode.description}>
      <span className="mode-picker__label">Mode</span>
      <select
        className="mode-picker__select"
        value={mode.id}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
