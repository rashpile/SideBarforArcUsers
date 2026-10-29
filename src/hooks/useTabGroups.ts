import { useState, useEffect, useCallback } from 'react';

export const useTabGroups = () =>
{
  const [tabGroups, setTabGroups] = useState<chrome.tabGroups.TabGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((operation: string) =>
  {
    const err = chrome.runtime.lastError;
    if (err)
    {
      console.error(`TabGroup ${operation} error:`, err.message);
      setError(err.message || `Failed to ${operation}`);
      return true;
    }
    setError(null);
    return false;
  }, []);

  const fetchTabGroups = useCallback(() =>
  {
    if (typeof chrome !== 'undefined' && chrome.tabGroups)
    {
      chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, (result) =>
      {
        if (!handleError('fetch'))
        {
          setTabGroups(result);
        }
      });
    }
  }, [handleError]);

  useEffect(() =>
  {
    fetchTabGroups();

    const listeners: Array<chrome.events.Event<() => void> | undefined> = [
      chrome.tabGroups?.onCreated,
      chrome.tabGroups?.onUpdated,
      chrome.tabGroups?.onRemoved,
      chrome.tabGroups?.onMoved,
    ];

    const handleUpdate = () => fetchTabGroups();

    listeners.forEach((listener) => listener?.addListener(handleUpdate));

    return () =>
    {
      listeners.forEach((listener) => listener?.removeListener(handleUpdate));
    };
  }, [fetchTabGroups]);

  const updateGroup = useCallback((groupId: number,
                                   properties: { title?: string; color?: chrome.tabGroups.ColorEnum }) =>
  {
    chrome.tabGroups.update(groupId, properties, () =>
    {
      handleError('update');
    });
  }, [handleError]);

  const moveGroup = useCallback((groupId: number, index: number) =>
  {
    chrome.tabGroups.move(groupId, { index }, () =>
    {
      handleError('move');
    });
  }, [handleError]);

  return { tabGroups, updateGroup, moveGroup, error };
};
