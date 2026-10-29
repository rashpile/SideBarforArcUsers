export function isActivationForWindow(
  currentWindowId: number | null,
  activeInfo: Pick<chrome.tabs.TabActiveInfo, 'windowId'>
): boolean
{
  return currentWindowId !== null && activeInfo.windowId === currentWindowId;
}
