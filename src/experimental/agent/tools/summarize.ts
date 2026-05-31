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
    "Summarize a piece of text using the browser's built-in Summarizer model (on-device). Use when the user asks for a tl;dr, key points, or a headline. Returns an empty summary if the API is unavailable.",
  readOnly: true,
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
