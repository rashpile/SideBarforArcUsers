// Scripts the page agent writes are kept in the chat and in saved page styles in chrome.storage.local,
// whose quota they share with everything else; the cap keeps one script from filling it.

export const PAGE_AGENT_SCRIPT_MAX_BYTES = 64 * 1024;

export type PageAgentScriptCheckResult = { ok: true } | { ok: false; reason: string };

export class PageAgentScriptCheck
{
  static check(code: string): PageAgentScriptCheckResult
  {
    if (new TextEncoder().encode(code).length > PAGE_AGENT_SCRIPT_MAX_BYTES)
    {
      return { ok: false, reason: `the script is larger than ${PAGE_AGENT_SCRIPT_MAX_BYTES / 1024} KB` };
    }
    return { ok: true };
  }
}
