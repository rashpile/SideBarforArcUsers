// The page agent plugins the user can switch on and off in Settings > AI. Only metadata lives here,
// with no Chrome or page access, so Settings imports it without loading the plugins themselves.

export interface PageAgentPluginInfo
{
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
}

export const VIDEO_TRANSCRIPTS_PLUGIN_ID = 'video-transcripts';

export const PAGE_AGENT_PLUGINS: readonly PageAgentPluginInfo[] = [
  {
    id: VIDEO_TRANSCRIPTS_PLUGIN_ID,
    title: 'Video transcripts',
    description: 'Read the subtitles of the video on the page: Prime Video and videos with subtitle tracks',
    defaultEnabled: true,
  },
];

/**
 * The user's choices as stored in the AI settings. Only plugins the user switched hold a value, so a
 * plugin added in a later version starts with its default.
 */
export class PageAgentPluginSwitches
{
  readonly #stored: Readonly<Record<string, boolean>>;

  constructor(stored: Readonly<Record<string, boolean>>)
  {
    this.#stored = { ...stored };
  }

  isEnabled(info: PageAgentPluginInfo): boolean
  {
    const stored = this.#stored[info.id];
    return typeof stored === 'boolean' ? stored : info.defaultEnabled;
  }

  with(id: string, enabled: boolean): PageAgentPluginSwitches
  {
    return new PageAgentPluginSwitches({ ...this.#stored, [id]: enabled });
  }

  toStored(): Record<string, boolean>
  {
    return { ...this.#stored };
  }

  enabledIds(): string[]
  {
    return PAGE_AGENT_PLUGINS.filter(info => this.isEnabled(info)).map(info => info.id);
  }
}
