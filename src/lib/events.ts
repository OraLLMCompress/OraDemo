// Wire types shared by the /api/generate route and the page. Type-only, so no
// runtime code is shipped to the browser.
import type { ModelId } from "./models";

// A single chat turn, in OpenAI chat-completions shape.
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// The request body the page POSTs to /api/generate.
export type GenerateRequest = { model: ModelId; messages: ChatMessage[] };

// The SSE events the route streams back to the page.
export type GenEvent =
  | { type: "delta"; delta: string }
  | { type: "done"; ttftMs: number; tps: number; tokens: number }
  | { type: "error"; error: string };
