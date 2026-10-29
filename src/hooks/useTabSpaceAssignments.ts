import { useEffect, useState } from 'react';
import { tabSpaceRegistryProxy } from '../managers/proxies/tabSpaceRegistryProxy';
import { TAB_SPACE_ASSIGNMENTS_CHANGED } from '../managers/shared/tabSpaceRegistryApi';

export function useTabSpaceAssignments(windowId: number | null | undefined): Record<number, string>
{
  const [assignments, setAssignments] = useState<Record<number, string>>({});

  useEffect(() =>
  {
    if (!windowId)
    {
      setAssignments({});
      return;
    }

    let active = true;
    void tabSpaceRegistryProxy.getWindowAssignments(windowId).then(result =>
    {
      if (active) setAssignments(result);
    });

    const listener = (message: Record<string, unknown>) =>
    {
      if (message.action !== TAB_SPACE_ASSIGNMENTS_CHANGED || message.windowId !== windowId) return;
      setAssignments(message.assignments as Record<number, string>);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () =>
    {
      active = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [windowId]);

  return assignments;
}
