// The side panel's PageAgentChats. The chats and their store load with the panel, because every
// panel deletes the chat of a closed tab. The run loop, the model client and the page scripts
// (PageAgentRuntime) load on first use: most panels never run the agent, and the panel's cold start
// shouldn't carry them.

import type { AiRenameSettings } from '../../utils/aiConfig.ts';
import { PageAgentChats } from './pageAgentChats.ts';
import type { PageAgentChatPage, PageAgentLiveRun, PageAgentRunStart } from './pageAgentChats.ts';
import { PageAgentChatStore } from './pageAgentChatStore.ts';
import type { PageAgentChatStorageArea } from './pageAgentChatStore.ts';
import type { PageAgentRunResult } from './pageAgentRun.ts';
import type { PageAgentRuntime } from './pageAgentRuntime.ts';

class LazyPageAgentRuntime
{
  readonly #debug: boolean;
  #loading: Promise<PageAgentRuntime> | null = null;

  constructor(debug: boolean)
  {
    this.#debug = debug;
  }

  get(): Promise<PageAgentRuntime>
  {
    // A failed load (an extension update replaced the chunk) is tried again on the next use.
    this.#loading ??= import('./pageAgentRuntime.ts')
      .then(module => new module.PageAgentRuntime(this.#debug))
      .catch((error: unknown) =>
      {
        this.#loading = null;
        throw error;
      });
    return this.#loading;
  }
}

/** PageAgentChats starts a run synchronously; the PageAgentRun exists once the runtime has loaded. */
class DeferredRun implements PageAgentLiveRun
{
  readonly #runtime: LazyPageAgentRuntime;
  readonly #start: PageAgentRunStart<AiRenameSettings>;
  #run: PageAgentLiveRun | null = null;
  #stopped = false;

  constructor(runtime: LazyPageAgentRuntime, start: PageAgentRunStart<AiRenameSettings>)
  {
    this.#runtime = runtime;
    this.#start = start;
  }

  async run(): Promise<PageAgentRunResult>
  {
    const run = (await this.#runtime.get()).createRun(this.#start);
    this.#run = run;
    // Stop came while the runtime loaded: the run ends as stopped and reports it like any other.
    if (this.#stopped)
    {
      run.stop();
    }
    return await run.run();
  }

  stop(): void
  {
    this.#stopped = true;
    this.#run?.stop();
  }
}

/** Undo, Re-apply and the marker check, through the runtime's ChromePageAdapter. */
class LazyChatPage implements PageAgentChatPage
{
  readonly #runtime: LazyPageAgentRuntime;

  constructor(runtime: LazyPageAgentRuntime)
  {
    this.#runtime = runtime;
  }

  async insertCss(tabId: number, text: string): Promise<void>
  {
    await (await this.#runtime.get()).page.insertCss(tabId, text);
  }

  async removeCss(tabId: number, text: string): Promise<void>
  {
    await (await this.#runtime.get()).page.removeCss(tabId, text);
  }

  async pageUrl(tabId: number): Promise<string>
  {
    return await (await this.#runtime.get()).page.pageUrl(tabId);
  }

  async readMarker(tabId: number): Promise<string>
  {
    return await (await this.#runtime.get()).page.readMarker(tabId);
  }
}

/** One per side panel, for the panel's lifetime: a run outlives the drawer that started it. */
export function createPanelPageAgentChats(
  storageArea: PageAgentChatStorageArea,
  debug: boolean,
): PageAgentChats<AiRenameSettings>
{
  const runtime = new LazyPageAgentRuntime(debug);
  return new PageAgentChats<AiRenameSettings>({
    store: new PageAgentChatStore(storageArea),
    runFactory: start => new DeferredRun(runtime, start),
    page: new LazyChatPage(runtime),
    debug,
  });
}
