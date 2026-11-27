// =============================================================================
// Clipboard message between background.ts (PageUrlCopier) and offscreen.html (src/offscreen.ts)
// =============================================================================

// Every extension page gets every runtime message, so the offscreen page answers only messages
// with this target, and the sidebar's listeners leave them alone.
export const OFFSCREEN_MESSAGE_TARGET = 'offscreen';
export const COPY_TO_CLIPBOARD_ACTION = 'copy-to-clipboard';

export interface CopyToClipboardRequest
{
  target: typeof OFFSCREEN_MESSAGE_TARGET;
  action: typeof COPY_TO_CLIPBOARD_ACTION;
  text: string;
}

export interface CopyToClipboardResponse
{
  ok: boolean;
}

export function createCopyToClipboardRequest(text: string): CopyToClipboardRequest
{
  return { target: OFFSCREEN_MESSAGE_TARGET, action: COPY_TO_CLIPBOARD_ACTION, text };
}

export function isCopyToClipboardRequest(message: unknown): message is CopyToClipboardRequest
{
  if (typeof message !== 'object' || message === null)
  {
    return false;
  }
  const candidate = message as Record<string, unknown>;
  return candidate.target === OFFSCREEN_MESSAGE_TARGET
    && candidate.action === COPY_TO_CLIPBOARD_ACTION
    && typeof candidate.text === 'string';
}
