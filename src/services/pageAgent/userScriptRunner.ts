// Runs page agent scripts through chrome.userScripts.execute in a USER_SCRIPT world of the extension's
// own, one per page origin. The side panel (ChromePageAdapter) and the background (PageStyleApplier)
// both use it; the API comes in as a getter because chrome.userScripts appears only once the user turns
// on Allow User Scripts, possibly after this object was built.
//
// Named UserScript* so it isn't confused with PageScriptWorld and pageScripts.ts, which are the
// chrome.scripting injections.

import { NoUserScriptWorldError } from '../../utils/pageAgentScript.ts';
import { runUserScriptCommand } from './userScriptRuntime.ts';
import type { UserScriptCommand, UserScriptLimits, UserScriptResult } from './userScriptRuntime.ts';

const LIMITS: UserScriptLimits = { maxValueChars: 12000, maxErrors: 5, timeoutMs: 10000 };

const WORLD_ID_PREFIX = 'page-agent:';

// The origin is written into the CSP, so it must be a plain CSP host source: URL accepts hosts such as
// "a;b.com", whose ";" would end the directive.
const CSP_SAFE_ORIGIN = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.?(:\d+)?$/;

const DID_NOT_RUN = 'the script did not run; the page may still be loading or not allow scripts';

export class UserScriptWorld
{
  readonly worldId: string;
  /**
   * Network the script starts (fetch / XHR, and the images, media, scripts, fonts and stylesheets it
   * loads) reaches only the page's own origin: page text reaches the model, so a prompt-injected page
   * could otherwise have the agent send the page's data elsewhere. 'self' is the extension's origin,
   * hence the page origin written out. 'unsafe-eval' lets the runtime compile the agent's code.
   */
  readonly csp: string;

  constructor(origin: string)
  {
    this.worldId = `${WORLD_ID_PREFIX}${origin}`;
    this.csp = [
      "default-src 'none'",
      "script-src 'self' 'unsafe-eval'",
      `connect-src ${origin}`,
      `img-src ${origin} data: blob:`,
      `media-src ${origin} data: blob:`,
      `font-src ${origin} data:`,
      `style-src ${origin} 'unsafe-inline'`,
    ].join('; ');
  }

  /** Null unless the URL is http(s) with an origin the CSP can name. */
  static forUrl(url: string): UserScriptWorld | null
  {
    let origin: string;
    try
    {
      origin = new URL(url).origin;
    }
    catch
    {
      return null;
    }
    return CSP_SAFE_ORIGIN.test(origin) ? new UserScriptWorld(origin) : null;
  }
}

export class UserScriptRunner
{
  readonly #api: () => UserScriptsApi | undefined;

  constructor(api: () => UserScriptsApi | undefined)
  {
    this.#api = api;
  }

  /** Chrome 135+ with the userScripts permission and Allow User Scripts on. */
  available(): boolean
  {
    return this.#availableApi() !== null;
  }

  /** Rejects with NoUserScriptWorldError when the URL has no world, with a plain Error when user scripts are unavailable. */
  async run(tabId: number, url: string, command: UserScriptCommand): Promise<UserScriptResult>
  {
    const world = UserScriptWorld.forUrl(url);
    if (!world)
    {
      throw new NoUserScriptWorldError();
    }
    const api = this.#availableApi();
    if (!api)
    {
      throw new Error("Chrome doesn't allow user scripts; turn on Allow User Scripts on the extension's Details page");
    }
    // Configured on every run: it is cheap, and Chrome may have dropped the world's configuration.
    await api.configureWorld({ worldId: world.worldId, csp: world.csp });
    const results = await api.execute({
      target: { tabId },
      js: [{ code: `(${runUserScriptCommand})(${JSON.stringify(command)}, ${JSON.stringify(LIMITS)})` }],
      worldId: world.worldId,
      injectImmediately: false,
    });
    return scriptResult(results?.[0]);
  }

  #availableApi(): UserScriptsApi | null
  {
    try
    {
      const api = this.#api();
      if (!api || typeof api.execute !== 'function')
      {
        return null;
      }
      // getScripts throws while Allow User Scripts is off; the promise it returns otherwise carries
      // nothing this check needs, so its rejection is dropped.
      Promise.resolve(api.getScripts()).catch(() => undefined);
      return api;
    }
    catch
    {
      return null;
    }
  }
}

// execute() gives a null result, with no error, for code that throws or doesn't parse; the runtime
// catches both, so a missing result means the runtime itself never ran.
function scriptResult(injection: UserScriptsInjectionResult | undefined): UserScriptResult
{
  const result = injection?.result;
  if (result && typeof result === 'object' && typeof (result as { ok?: unknown }).ok === 'boolean')
  {
    return result as UserScriptResult;
  }
  const error = typeof injection?.error === 'string' && injection.error ? `${DID_NOT_RUN} (${injection.error})` : DID_NOT_RUN;
  return { ok: false, compiled: false, error, errors: [] };
}
