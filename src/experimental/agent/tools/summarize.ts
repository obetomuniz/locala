/**
 * `summarize_text` tool: wraps `@web-ai-sdk/summarizer`. Demonstrates how
 * the agent can compose multiple Built-in Web AI APIs through the SDK —
 * the planner (Prompt API) decides when a long piece of text needs to be
 * condensed and dispatches to the Summarizer model on the device.
 */

import {
  isAvailable as isSummarizerAvailable,
  summarize,
} from "@web-ai-sdk/summarizer";
import type { AgentTool } from "../types";

interface SummarizeInput {
  text: string;
  /** "tldr" (paragraph) | "key-points" (list) | "headline" (one line). */
  type?: "tldr" | "key-points" | "headline";
  /** "short" | "medium" | "long". */
  length?: "short" | "medium" | "long";
}

interface SummarizeOutput {
  summary: string;
  cached: boolean;
}

export const summarizeTool: AgentTool<SummarizeInput, SummarizeOutput> = {
  name: "summarize_text",
  description:
    "Condense EXISTING text into a shorter form with the browser's built-in Summarizer (on-device). Use ONLY when the user supplies text (or you fetched a document) AND explicitly asks to shorten/summarize it or pull key points from THAT text — pass the real source text in `text`. Do NOT use it to write, generate, compose, draft, or expand new content (e.g. 'write an article/story/post'); produce that yourself directly with no tool. Returns an empty summary if the API is unavailable.",
  readOnly: true,
  // Intentionally NOT `returnDirect`. The summarizer's output is fed back as a
  // tool result so the model composes the final reply around it. This keeps a
  // misrouted call (the small model sometimes reaches for it on "write an
  // article" requests) non-fatal: instead of the short summary short-circuiting
  // as the whole answer, the loop continues and the model still produces what
  // was actually asked for.
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      type: { type: "string", enum: ["tldr", "key-points", "headline"] },
      length: { type: "string", enum: ["short", "medium", "long"] },
    },
    required: ["text"],
    additionalProperties: false,
  },
  async execute({ text, type = "tldr", length = "short" }, { signal }) {
    if (!isSummarizerAvailable()) {
      return { summary: "", cached: false };
    }
    const result = await summarize({
      input: text,
      type,
      length,
      language: "en",
      format: "plain-text",
      signal,
    });
    return { summary: result.output ?? "", cached: result.cached };
  },
};
