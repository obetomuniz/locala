/**
 * Smart autoscroll for streaming views (chat transcript, agent transcript,
 * event log). Pins the scroll container to the bottom only while the user
 * is already there. The moment they scroll up it yields and stops fighting
 * them, and it resumes automatically as soon as they scroll back to the
 * bottom — so they can read earlier content mid-stream without the view
 * yanking them down on every token.
 *
 * Pass the streaming value(s) in `deps` (e.g. `[messages]`, or
 * `[text, events.length]`) so a scroll-to-bottom is attempted on each
 * update. The bottom write is a cheap `scrollTop = scrollHeight` that the
 * browser batches with paint, so dense token streams stay smooth.
 */

import { useEffect, useRef, type RefObject } from "react";

const NEAR_BOTTOM_PX = 80;

export function useStickToBottom<T extends HTMLElement>(
  ref: RefObject<T | null>,
  deps: ReadonlyArray<unknown>,
  nearBottomPx: number = NEAR_BOTTOM_PX,
): void {
  // Default to "stuck" so the first content lands at the bottom even
  // before the user has scrolled at all.
  const stuckRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Re-derive stickiness from the scroll position: stuck only when the
    // viewport bottom is within `nearBottomPx` of the content bottom. This
    // is what RE-ENABLES autoscroll when the user scrolls back down.
    const recompute = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stuckRef.current = dist <= nearBottomPx;
    };

    // Upward user intent unsticks IMMEDIATELY, so a programmatic
    // scroll-to-bottom triggered by the next streamed token can't yank the
    // user back down while they're reading. Without this, a fast stream can
    // win the race against the passive scroll handler and feel like the
    // view "won't let you scroll up".
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stuckRef.current = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") {
        stuckRef.current = false;
      }
    };

    el.addEventListener("scroll", recompute, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("scroll", recompute);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, nearBottomPx]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stuckRef.current) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
