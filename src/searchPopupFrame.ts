// Search popup frame - puts search.html in an iframe over the page; see src/services/searchPopup.ts
// for the flow. It runs as a classic script, so it must not import anything (the message names
// repeat src/utils/searchPopupMessages.ts).

(() =>
{
  const scope = globalThis as typeof globalThis & { __sidebarSearchFrameDispose?: () => void };
  scope.__sidebarSearchFrameDispose?.();
  scope.__sidebarSearchFrameDispose = () =>
  {
    delete scope.__sidebarSearchFrameDispose;
  };
})();
