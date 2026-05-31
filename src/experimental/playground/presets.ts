/**
 * Pre-baked agent configurations for the playground. Each preset is a
 * small, focused demonstration of what the agent + Built-in Web AI APIs
 * can do without writing any host code.
 */

import {
  clockNowTool,
  detectLanguageTool,
  summarizeTool,
  translateTool,
  clipboardReadTool,
  clipboardWriteTool,
  createFetchUrlTool,
} from "../agent/tools";
import type { AgentTool } from "../agent/types";

export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: AgentTool[];
  examples: string[];
}

// Generous raw cap so full blog/article HTML is captured before the
// tool extracts clean reading text (the article body often sits past
// the first tens of KB of head / nav / inline CSS).
const fetchUrl = createFetchUrlTool();

export const PRESETS: AgentPreset[] = [
  {
    id: "minimal",
    name: "Minimal",
    description:
      "Bare agent with no tools. Useful to verify the planner loop and structured-output dispatch are healthy on this device.",
    systemPrompt:
      "You are a friendly, terse assistant. Answer the user directly in markdown.",
    tools: [],
    examples: ["Explain what React is in 3 bullet points."],
  },
  {
    id: "web-ai-suite",
    name: "Built-in Web AI suite",
    description:
      "Exposes every Built-in Web AI API the SDK or browser surfaces today: Summarizer (via SDK), Translator, Language Detector. The planner composes them.",
    systemPrompt:
      "You orchestrate the browser's Built-in Web AI APIs. Prefer specialized tools (summarizer, translator, language detector) over solving everything in prose.",
    tools: [summarizeTool, translateTool, detectLanguageTool, clockNowTool],
    examples: [
      "Summarize: \"WebMCP exposes browser-page tools to AI agents via navigator.modelContext, mirroring the Model Context Protocol pattern for the web.\"",
      "What language is 'Eu vou ao mercado amanhã' in? Translate it to English.",
      "It's almost lunchtime. What's the current time?",
    ],
  },
  {
    id: "platform",
    name: "Platform reach",
    description:
      "Adds general-purpose web platform tools: HTTP fetch (JSON parsed, HTML reduced to clean article text), clock, and clipboard read/write.",
    systemPrompt:
      "You are a research and productivity assistant. For ANY URL the user provides, you MUST call `fetch_url` first — you do not know what is on a page without fetching it. If the fetch fails (often CORS), say so explicitly; never invent or guess the page contents. Fetch is read-only and capped to 32 KB; clipboard tools require user permission.",
    tools: [
      fetchUrl,
      clockNowTool,
      clipboardReadTool,
      clipboardWriteTool,
      summarizeTool,
    ],
    examples: [
      "Fetch https://api.github.com/repos/obetomuniz/web-ai-sdk and tell me how many stars it has.",
      "What time is it in Tokyo right now?",
    ],
  },
  {
    id: "kitchen-sink",
    name: "Kitchen sink",
    description:
      "Everything the playground knows about. Useful for exploring how the planner picks tools when many are available.",
    systemPrompt:
      "You are a research and productivity assistant running on the user's device. Use the most specialized tool for each subtask. For ANY URL the user provides, you MUST call `fetch_url` first to get the actual contents — never invent or guess what a page contains, and never summarize a URL without fetching it. If the fetch fails (often CORS), say so explicitly. Stop as soon as you have the answer.",
    tools: [
      summarizeTool,
      translateTool,
      detectLanguageTool,
      clockNowTool,
      fetchUrl,
      clipboardReadTool,
      clipboardWriteTool,
    ],
    examples: [
      "Detect the language of 'こんにちは', then translate it to English and Portuguese.",
      "Fetch the README of https://api.github.com/repos/obetomuniz/web-ai-sdk/readme, base64-decode it, and give me a 3-bullet summary.",
    ],
  },
];
