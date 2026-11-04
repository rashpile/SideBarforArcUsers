// The part of the page agent that talks to the model and the page: the run loop, the model client,
// the page scripts. The side panel loads it on first use (see panelPageAgent.ts).

import type { AiRenameSettings } from '../../utils/aiConfig.ts';
import { ChromePageAdapter } from './chromePageAdapter.ts';
import type { PageAgentRunStart } from './pageAgentChats.ts';
import { PageAgentApiClient } from './pageAgentModelClient.ts';
import type { PageAgentToolPlugin } from './pageAgentPlugin.ts';
import { PAGE_SCRIPTS_PLUGIN_ID, PageAgentPluginSwitches, VIDEO_TRANSCRIPTS_PLUGIN_ID } from './pageAgentPlugins.ts';
import { PageAgentRun } from './pageAgentRun.ts';
import { VideoTranscriptPlugin } from './videoTranscriptPlugin.ts';

type PageAgentPluginFactory = (page: ChromePageAdapter) => PageAgentToolPlugin;

// Keyed by the ids in PAGE_AGENT_PLUGINS. Kept here rather than in the metadata, so Settings can list
// the plugins without loading their code.
const PLUGIN_FACTORIES = new Map<string, PageAgentPluginFactory>([
  [VIDEO_TRANSCRIPTS_PLUGIN_ID, page => new VideoTranscriptPlugin(page)],
]);

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
    const switches = new PageAgentPluginSwitches(start.settings.agentPlugins);
    return new PageAgentRun({
      tabId: start.tabId,
      request: start.request,
      // A new client per run: the protocol Auto settles on holds for one run only.
      client: new PageAgentApiClient(start.settings),
      adapter: this.page,
      listener: start.listener,
      // Also without <all_urls>: the screenshot tool then tells the model why there is no image.
      screenshots: start.settings.acceptsImages,
      scripts: this.#scriptsAllowed(switches),
      plugins: this.#enabledPlugins(switches),
      history: start.history,
      currentCss: start.currentCss,
      currentCssByUser: start.currentCssByUser,
      currentScript: start.currentScript,
      insertedText: start.insertedText,
      debug: this.#debug,
    });
  }

  // Availability too, so the model isn't offered script tools that Chrome would refuse.
  #scriptsAllowed(switches: PageAgentPluginSwitches): boolean
  {
    return switches.isEnabledId(PAGE_SCRIPTS_PLUGIN_ID) && this.page.userScriptsAvailable();
  }

  /** Switching a plugin off in Settings takes effect from the next request. */
  #enabledPlugins(switches: PageAgentPluginSwitches): PageAgentToolPlugin[]
  {
    const plugins: PageAgentToolPlugin[] = [];
    for (const id of switches.enabledIds())
    {
      const create = PLUGIN_FACTORIES.get(id);
      if (create)
      {
        plugins.push(create(this.page));
      }
    }
    return plugins;
  }
}
