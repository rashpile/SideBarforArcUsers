// Offscreen document for clipboard writes (see src/services/pageUrlCopier.ts).
//
// The service worker has no DOM, and navigator.clipboard.writeText fails in a document without
// focus, which an offscreen document never has. execCommand('copy') on a selected textarea works
// here because the CLIPBOARD reason and the clipboardWrite permission allow it.

import {
  isCopyToClipboardRequest,
  type CopyToClipboardResponse,
} from './utils/offscreenClipboardMessage.ts';

function copyText(text: string): boolean
{
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  try
  {
    textarea.select();
    return document.execCommand('copy');
  }
  catch
  {
    return false;
  }
  finally
  {
    textarea.remove();
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) =>
{
  // Background broadcasts reach this page too; leaving them unanswered lets their real
  // receivers reply.
  if (!isCopyToClipboardRequest(message))
  {
    return false;
  }
  const response: CopyToClipboardResponse = { ok: copyText(message.text) };
  sendResponse(response);
  return false;
});
