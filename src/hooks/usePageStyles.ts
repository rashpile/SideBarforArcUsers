import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { pageStyleProxy } from '../managers/proxies/pageStyleProxy';
import { ManagerId } from '../managers/proxies/messageRouting';
import type { SavedPageStyle } from '../stores/savedPageStyles';

/** The changes to saved page styles; each rejects with the manager's reason. */
export interface PageStyleActions
{
  save(bookmarkId: string, css: string, pageUrl: string): Promise<void>;
  setAutoApply(bookmarkId: string, on: boolean): Promise<void>;
  remove(bookmarkId: string): Promise<void>;
}

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
    await withManagerReason('save', () => pageStyleProxy.save(bookmarkId, css, pageUrl));
  }, []);

  const setAutoApply = useCallback(async (bookmarkId: string, on: boolean): Promise<void> =>
  {
    await withManagerReason('setAutoApply', () => pageStyleProxy.setAutoApply(bookmarkId, on));
  }, []);

  const remove = useCallback(async (bookmarkId: string): Promise<void> =>
  {
    await withManagerReason('remove', () => pageStyleProxy.remove(bookmarkId));
  }, []);

  return { styleFor, save, setAutoApply, remove };
};

// callManager puts "<manager>.<method> failed: " before the manager's message; the user should
// read only the reason ("Can't save this style: ...") after the drawer's own label.
async function withManagerReason<T>(method: string, call: () => Promise<T>): Promise<T>
{
  try
  {
    return await call();
  }
  catch (error)
  {
    const prefix = `${ManagerId.PAGE_STYLES}.${method} failed: `;
    if (error instanceof Error && error.message.startsWith(prefix))
    {
      throw new Error(error.message.slice(prefix.length));
    }
    throw error;
  }
}
