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

/**
 * What chrome.userScripts allows now: 'off' while the API is missing (no permission, or Allow User
 * Scripts off) or getScripts throws (Allow User Scripts off), 'outdated' when this Chrome has the API
 * but no execute() (before 135). Here rather than in the runner, so the side panel's notices can read
 * it without loading the runner and the in-page runtime.
 */
export type UserScriptsApiState = 'available' | 'off' | 'outdated';

export function userScriptsApiState(api: UserScriptsApi | undefined): UserScriptsApiState
{
  if (!api)
  {
    return 'off';
  }
  try
  {
    // getScripts throws while Allow User Scripts is off; the promise it returns otherwise carries
    // nothing this check needs, so its rejection is dropped.
    Promise.resolve(api.getScripts()).catch(() => undefined);
  }
  catch
  {
    return 'off';
  }
  return typeof api.execute === 'function' ? 'available' : 'outdated';
}

/**
 * The page has no user script world (it isn't an http(s) page), so no agent script can be running
 * on it. Kept here rather than in the runner, so the side panel's chats can recognize it without
 * loading the runner and the in-page runtime.
 */
export class NoUserScriptWorldError extends Error
{
  constructor()
  {
    super('scripts run only on http and https pages');
    this.name = 'NoUserScriptWorldError';
  }
}
