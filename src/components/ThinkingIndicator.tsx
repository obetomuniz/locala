import { useEffect, useState } from "react";

const VERBS = [
  "Thinking",
  "Pondering",
  "Mulling",
  "Drafting",
  "Composing",
  "Tinkering",
  "Reflecting",
  "Sparking",
  "Conjuring",
  "Whirring",
  "Brewing",
  "Cogitating",
  "Ruminating",
  "Wondering",
];

const ROTATION_MS = 1700;

function pickDifferent(current: string): string {
  if (VERBS.length <= 1) return VERBS[0];
  let next = current;
  while (next === current) {
    next = VERBS[Math.floor(Math.random() * VERBS.length)];
  }
  return next;
}

export function ThinkingIndicator() {
  const [verb, setVerb] = useState(
    () => VERBS[Math.floor(Math.random() * VERBS.length)],
  );

  useEffect(() => {
    const id = setInterval(() => {
      setVerb((current) => pickDifferent(current));
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="thinking" aria-live="polite">
      <span key={verb} className="thinking__verb">
        {verb}
      </span>
      <span className="thinking__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
