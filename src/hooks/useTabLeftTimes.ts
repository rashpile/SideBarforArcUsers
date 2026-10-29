import { useEffect, useState } from 'react';
import { TabActivityTracker, TabLeftTimes } from '../stores/tabActivityTracker';

const NO_LEFT_TIMES = new TabLeftTimes();

function logUnreadableRecords(error: unknown): void
{
  if (import.meta.env.DEV)
  {
    console.warn('[useTabLeftTimes] Unreadable tab activity records:', error);
  }
}

/**
 * When the user last left each tab, for the Tab list's age highlight. Reads the
 * records background.ts keeps (TabActivityTracker) and follows their changes.
 * Idle while `enabled` is false: nothing is read and no times are returned.
 */
export function useTabLeftTimes(enabled: boolean): TabLeftTimes
{
  const [leftTimes, setLeftTimes] = useState(NO_LEFT_TIMES);

  useEffect(() =>
  {
    if (!enabled) return;

    let mounted = true;
    const key = TabActivityTracker.RECORDS_KEY;

    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) =>
    {
      if (areaName !== 'local' || !(key in changes)) return;
      setLeftTimes(TabLeftTimes.fromStored(changes[key].newValue, logUnreadableRecords));
    };
    chrome.storage.onChanged.addListener(listener);

    chrome.storage.local.get(key).then(result =>
    {
      if (mounted) setLeftTimes(TabLeftTimes.fromStored(result[key], logUnreadableRecords));
    }).catch(error =>
    {
      if (import.meta.env.DEV)
      {
        console.error('[useTabLeftTimes] Failed to read tab activity records:', error);
      }
    });

    return () =>
    {
      mounted = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [enabled]);

  return enabled ? leftTimes : NO_LEFT_TIMES;
}
