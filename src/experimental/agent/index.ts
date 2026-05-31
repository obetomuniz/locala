/**
 * Experimental agent loop barrel.
 *
 * Three layers:
 *
 *   1. Core      — `createAgent`, the modules behind it, and the
 *                  AgentStream wrapper that consumers iterate.
 *   2. Composition — `transforms` for pipe()ing onto a stream.
 *   3. Registry  — `ToolRegistry` for sharing tools between the in-page
 *                  agent and external agents via @web-ai-sdk/webmcp.
 *
 * See `./README.md` for the architecture diagram and composition
 * examples.
 */

export { createAgent } from "./createAgent";
export {
  streamFromGenerator,
  streamFromResult,
} from "./events";
export * as transforms from "./transforms";
export {
  collectText,
  textStream,
  onlyType,
  map,
  filter,
  tap,
  tee,
  addTiming,
  debounceText,
  logEvents,
} from "./transforms";
export {
  ToolRegistry,
  sharedToolRegistry,
  type RegisterToolOptions,
} from "./tools/registry";
export {
  AgentUnavailableError,
  AgentToolValidationError,
  AgentUnknownToolError,
  AgentToolExecutionError,
} from "./errors";
export type {
  Agent,
  AgentEvent,
  AgentEventOf,
  AgentOnToolErrorPolicy,
  AgentPlan,
  AgentRunResult,
  AgentStep,
  AgentStopReason,
  AgentStream,
  AgentTool,
  AgentToolCallRecord,
  AgentToolContext,
  AgentToolInput,
  AgentToolOutput,
  AgentTransform,
  CreateAgentOptions,
} from "./types";
export * as tools from "./tools";
