import { useSyncExternalStore } from 'react';
import { spaceManagerProxy } from '../managers/proxies/spaceManagerProxy';
import { Space } from '../utils/spaceMessages';

/**
 * Reads the archived Task Spaces from spaceManagerProxy's mirror, filled by
 * spaceManagerProxy.load() and kept current like useSpaces. Readonly for the
 * same reason: it is the live array behind the mirror. Change it through
 * spaceManagerProxy.restoreTaskSpace / deleteArchivedTaskSpace.
 */
export function useArchivedTaskSpaces(): readonly Space[]
{
  return useSyncExternalStore(
    spaceManagerProxy.archivedStore.subscribe,
    spaceManagerProxy.archivedStore.getSnapshot
  );
}
