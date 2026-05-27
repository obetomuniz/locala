import {
  isAvailable as isSummarizerAvailable,
  summarize,
} from "@web-ai-sdk/summarizer";

// Only summarize when the input would actually lose information in the
// title-truncation fallback (~32 chars). Anything shorter fits whole.
const MIN_LENGTH_FOR_SUMMARY = 12;
const MAX_TITLE_CHARS = 60;

export { isSummarizerAvailable };

/**
 * Best-effort chat title from the first user message. Returns null when the
 * Summarizer API isn't available, the input is too short to be worth
 * summarizing, or the model returns nothing useful. Callers should fall back
 * to a truncation of the original text in those cases.
 */
export async function generateTitle(text: string): Promise<string | null> {
  if (!isSummarizerAvailable()) return null;
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH_FOR_SUMMARY) return null;

  try {
    const result = await summarize({
      input: trimmed,
      language: "en",
      type: "headline",
      format: "plain-text",
      length: "short",
    });
    if (!result.output) return null;
    const cleaned = result.output
      .replace(/^["'`*_\s]+|["'`*_\s.!?]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return null;
    return cleaned.length > MAX_TITLE_CHARS
      ? `${cleaned.slice(0, MAX_TITLE_CHARS - 1)}…`
      : cleaned;
  } catch {
    return null;
  }
}
