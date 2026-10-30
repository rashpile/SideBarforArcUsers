import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { attentionMarkProxy } from '../managers/proxies/attentionMarkProxy';

export const useAttentionMarks = () =>
{
  const marks = useSyncExternalStore(attentionMarkProxy.store.subscribe, attentionMarkProxy.store.getSnapshot);

  useEffect(() =>
  {
    attentionMarkProxy.load().catch(error => console.error('[AttentionMarks] load failed:', error));
  }, []);

  // New identities per mirror change, so memoized rows that take them re-render
  const isTabMarked = useCallback((tabId: number) => marks.isTabMarked(tabId), [marks]);
  const isBookmarkMarked = useCallback((id: string) => marks.isBookmarkMarked(id), [marks]);

  const markTabs = useCallback((tabIds: number[]) =>
  {
    attentionMarkProxy.markTabs(tabIds).catch(error => console.error('[AttentionMarks] markTabs failed:', error));
  }, []);

  const clearTabs = useCallback((tabIds: number[]) =>
  {
    attentionMarkProxy.clearTabs(tabIds).catch(error => console.error('[AttentionMarks] clearTabs failed:', error));
  }, []);

  const markBookmarks = useCallback((ids: string[]) =>
  {
    attentionMarkProxy.markBookmarks(ids).catch(error => console.error('[AttentionMarks] markBookmarks failed:', error));
  }, []);

  const clearBookmarks = useCallback((ids: string[]) =>
  {
    attentionMarkProxy.clearBookmarks(ids).catch(error => console.error('[AttentionMarks] clearBookmarks failed:', error));
  }, []);

  return { isTabMarked, isBookmarkMarked, markTabs, clearTabs, markBookmarks, clearBookmarks };
};
