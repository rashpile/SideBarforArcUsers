// Optional page agent tools the user can switch off in Settings > AI. A plugin brings its tool
// definitions and a system prompt section; the run sends it the calls of its tools with the run's
// tab id, so a plugin acts on the run's tab whichever tab the user switches to.

import type { PageAgentToolDefinition } from './pageAgentTools.ts';

/** `content` goes to the model; `summary` is the step's result in the side panel and is kept short. */
export type PageAgentPluginResult =
  | { ok: true; content: string; summary: string }
  | { ok: false; error: string };

export interface PageAgentToolPlugin
{
  readonly id: string;
  tools(): PageAgentToolDefinition[];
  /** Appended to the system prompt after the core text; empty for none. */
  promptSection(): string;
  /** A rejection or `{ ok: false }` reaches the model as a tool error, and the run goes on. */
  call(tool: string, args: unknown, tabId: number): Promise<PageAgentPluginResult>;
}
