// Screenshots for the page agent. chrome.tabs.captureVisibleTab captures whatever tab is in front
// of a window, not a tab by id, so the tab is checked before and after the capture: an image taken
// while another tab was in front would show the model, and send to the AI provider, a page the
// chat doesn't belong to.

import type { PageAgentCapture } from './pageAgentRun.ts';

export const CAPTURE_NOT_VISIBLE = 'not visible, use inspect';

const JPEG_QUALITY = 80;

export interface CaptureTab
{
  active: boolean;
  windowId: number;
}

/** The part of chrome.tabs the capture needs. */
export interface CaptureTabsApi
{
  get(tabId: number): Promise<CaptureTab>;
  captureVisibleTab(windowId: number, options: { format: 'jpeg'; quality: number }): Promise<string>;
}

export function screenshotsUnavailable(error: unknown): string
{
  const message = error instanceof Error ? error.message : String(error);
  return `screenshots unavailable: ${message || 'unknown error'}`;
}

export class ActiveTabCapture
{
  readonly #tabs: CaptureTabsApi;

  constructor(tabs: CaptureTabsApi)
  {
    this.#tabs = tabs;
  }

  /** A JPEG data URL of the tab, or why there is none. Rejects when the tab is gone. */
  async capture(tabId: number): Promise<PageAgentCapture>
  {
    const before = await this.#tabs.get(tabId);
    if (!before.active)
    {
      return { unavailable: CAPTURE_NOT_VISIBLE };
    }

    let dataUrl: string;
    try
    {
      dataUrl = await this.#tabs.captureVisibleTab(before.windowId, { format: 'jpeg', quality: JPEG_QUALITY });
    }
    catch (error)
    {
      // Usually a missing <all_urls> grant; the run goes on with inspect.
      return { unavailable: screenshotsUnavailable(error) };
    }

    // The user may have switched tabs, or moved this one to another window, while Chrome captured.
    const after = await this.#tabs.get(tabId);
    if (!after.active || after.windowId !== before.windowId)
    {
      return { unavailable: CAPTURE_NOT_VISIBLE };
    }
    return { dataUrl };
  }
}
