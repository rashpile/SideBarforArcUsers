// The part of the page agent that talks to the model and the page: the run loop, the model client,
// the page scripts. The side panel loads it on first use (see panelPageAgent.ts).

import type { AiRenameSettings } from '../../utils/aiConfig.ts';
import { ChromePageAdapter } from './chromePageAdapter.ts';
import type { PageAgentRunStart } from './pageAgentChats.ts';
import { PageAgentApiClient } from './pageAgentModelClient.ts';
import { PageAgentRun } from './pageAgentRun.ts';

export class PageAgentRuntime
{
  readonly page = new ChromePageAdapter();
  readonly #debug: boolean;

  constructor(debug: boolean)
  {
    this.#debug = debug;
  }

  /** A run with the AI settings of the moment the user sent the request. */
  createRun(start: PageAgentRunStart<AiRenameSettings>): PageAgentRun
  {
    return new PageAgentRun({
      tabId: start.tabId,
      request: start.request,
      // A new client per run: the protocol Auto settles on holds for one run only.
      client: new PageAgentApiClient(start.settings),
      adapter: this.page,
      listener: start.listener,
      // Also without <all_urls>: the screenshot tool then tells the model why there is no image.
      screenshots: start.settings.acceptsImages,
      history: start.history,
      currentCss: start.currentCss,
      insertedText: start.insertedText,
      debug: this.#debug,
    });
  }
}
