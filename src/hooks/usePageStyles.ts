import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { pageStyleProxy } from '../managers/proxies/pageStyleProxy';
import type { SavedPageStyle } from '../stores/savedPageStyles';

/**
 * The page styles saved to bookmarks and Favorites. The actions reject with the manager's reason
 * (the sanitizer refusing the CSS, a page that isn't http(s), a failed write), so the drawer can
 * show it; callers without an error display catch and log.
 */
export const usePageStyles = () =>
{
  const styles = useSyncExternalStore(pageStyleProxy.store.subscribe, pageStyleProxy.store.getSnapshot);

  useEffect(() =>
  {
    pageStyleProxy.load().catch(error => console.error('[PageStyles] load failed:', error));
  }, []);

  // A new identity per mirror change, so memoized consumers that take it re-render
  const styleFor = useCallback((bookmarkId: string): SavedPageStyle | null => styles.styleFor(bookmarkId), [styles]);

  const save = useCallback(async (bookmarkId: string, css: string, pageUrl: string): Promise<void> =>
  {
    await pageStyleProxy.save(bookmarkId, css, pageUrl);
  }, []);

  const setAutoApply = useCallback(async (bookmarkId: string, on: boolean): Promise<void> =>
  {
    await pageStyleProxy.setAutoApply(bookmarkId, on);
  }, []);

  const remove = useCallback(async (bookmarkId: string): Promise<void> =>
  {
    await pageStyleProxy.remove(bookmarkId);
  }, []);

  return { styleFor, save, setAutoApply, remove };
};
