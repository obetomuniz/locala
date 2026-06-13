/**
 * Hash-based router for the experimental folder. Keeps the main app's
 * routing (none, single-page) intact and lets us mount fully isolated
 * experiments behind URL hashes like `#experimental/agent`.
 *
 * Currently routes:
 *
 *   #experimental/agent  →  <AgentPlayground />
 *
 * Anything else returns `null` so the host app renders as usual.
 */

import { useEffect, useState } from "react";
const EXPERIMENTAL_PREFIX = "#experimental/";

export const EXPERIMENTAL_HASHES = {
  agent: `${EXPERIMENTAL_PREFIX}agent`,
} as const;

function readHash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash || "";
}

export function useExperimentalRoute(): string | null {
  const [hash, setHash] = useState(readHash);

  useEffect(() => {
    const onHashChange = () => setHash(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!hash.startsWith(EXPERIMENTAL_PREFIX)) return null;
  return hash.slice(EXPERIMENTAL_PREFIX.length);
}

export function ExperimentalRoute() {
  const route = useExperimentalRoute();

  if (!route) return null;

  if (route === "agent") {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return null;
  }

  return null;
}
