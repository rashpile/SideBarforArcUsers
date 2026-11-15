import { useEffect, useSyncExternalStore } from 'react';
import { hiddenTaskSpacesProxy } from '../managers/proxies/hiddenTaskSpacesProxy';
import type { HiddenTaskSpaces } from '../managers/shared/hiddenTaskSpacesApi';

/**
 * The Task Spaces hidden from the recent list, from hiddenTaskSpacesProxy's mirror. Hide through
 * hiddenTaskSpacesProxy.hide; background unhides a Space when a window enters it.
 */
export function useHiddenTaskSpaces(): HiddenTaskSpaces
{
  const hidden = useSyncExternalStore(hiddenTaskSpacesProxy.store.subscribe, hiddenTaskSpacesProxy.store.getSnapshot);

  useEffect(() =>
  {
    hiddenTaskSpacesProxy.load().catch(error => console.error('[HiddenTaskSpaces] load failed:', error));
  }, []);

  return hidden;
}
