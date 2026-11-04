import React, { useEffect, useState } from 'react';
import { ExternalLink, KeyRound } from 'lucide-react';
import { userScriptsApiState } from '../../utils/pageAgentScript';
import type { UserScriptsApiState } from '../../utils/pageAgentScript';

const USER_SCRIPTS_PERMISSION = 'userScripts';

/** 'unknown' until the first read. */
type UserScriptsStatus = 'unknown' | 'no-permission' | UserScriptsApiState;

const buttonClass = 'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700';

/**
 * Asks Chrome for the optional userScripts permission; resolves whether it was granted. Call it
 * straight from a click: Chrome asks only during a user gesture.
 */
export function requestUserScriptsPermission(): Promise<boolean>
{
  return chrome.permissions.request({ permissions: [USER_SCRIPTS_PERMISSION] })
    .catch(error =>
    {
      console.error('[UserScriptsNotice] permission request failed:', error);
      return false;
    });
}

/**
 * Where the notice shows: under the Page scripts switch and the agent's input, or in the code editor,
 * whose scripts run without that switch.
 */
type UserScriptsNoticeContext = 'page-scripts' | 'editor';

interface UserScriptsNoticeProps
{
  /** Shown while Chrome allows user scripts; without it the notice shows nothing then. */
  availableText?: string;
  context?: UserScriptsNoticeContext;
}

/**
 * Why the page agent's scripts can't run yet, with the button that fixes it: the permission, or
 * Allow User Scripts on the extension's Details page, which only the user can turn on.
 */
export const UserScriptsNotice: React.FC<UserScriptsNoticeProps> = ({ availableText, context = 'page-scripts' }) =>
{
  const status = useUserScriptsStatus();
  const notAllowedYet = context === 'editor'
    ? 'Chrome doesn’t allow this extension’s scripts yet'
    : 'Page scripts are on, but Chrome doesn’t allow them yet';

  switch (status)
  {
    case 'unknown':
      return null;
    case 'available':
      return availableText ? <p className="text-green-600 dark:text-green-400">{availableText}</p> : null;
    case 'no-permission':
      return (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <span className="flex-1">{notAllowedYet}: the extension needs your permission.</span>
          <button type="button" onClick={() => void requestUserScriptsPermission()} className={buttonClass}>
            <KeyRound size={12} />
            Allow scripts
          </button>
        </div>
      );
    // Chrome may leave chrome.userScripts undefined in an open page until it reloads, so the rechecks
    // can miss the toggle; reopening the panel reloads it.
    case 'off':
      return (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <span className="flex-1">
            {notAllowedYet}: turn on Allow User Scripts on the extension’s Details page. If this message stays
            after that, close and reopen the side panel.
          </span>
          <button type="button" onClick={openExtensionDetails} className={buttonClass}>
            <ExternalLink size={12} />
            Open extension details
          </button>
        </div>
      );
    case 'outdated':
      return (
        <p className="text-gray-500 dark:text-gray-400">
          {context === 'editor'
            ? 'This version of Chrome can’t run the extension’s scripts; they need Chrome 135 or later.'
            : 'Page scripts are on, but this version of Chrome can’t run them; they need Chrome 135 or later.'}
        </p>
      );
  }
};

/**
 * Read on mount and again whenever the user may have changed it: Allow User Scripts is a toggle on
 * another page and fires no event here, so the panel reads it when it gets focus or the user switches
 * tabs, as on the way back from the Details page.
 */
function useUserScriptsStatus(): UserScriptsStatus
{
  const [status, setStatus] = useState<UserScriptsStatus>('unknown');

  useEffect(() =>
  {
    let mounted = true;
    const check = () =>
    {
      readUserScriptsStatus()
        // A Chrome that doesn't know the permission rejects the check.
        .catch((): UserScriptsStatus => 'outdated')
        .then(next =>
        {
          if (mounted)
          {
            setStatus(next);
          }
        });
    };
    const onVisibilityChange = () =>
    {
      if (document.visibilityState === 'visible')
      {
        check();
      }
    };
    // The installed @types/chrome leaves removeListener off these events; Chrome has it.
    const permissionEvents = [chrome.permissions.onAdded, chrome.permissions.onRemoved] as unknown as chrome.events.Event<() => void>[];
    check();
    permissionEvents.forEach(event => event.addListener(check));
    chrome.tabs.onActivated.addListener(check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
    {
      mounted = false;
      permissionEvents.forEach(event => event.removeListener(check));
      chrome.tabs.onActivated.removeListener(check);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return status;
}

async function readUserScriptsStatus(): Promise<UserScriptsStatus>
{
  const granted = await chrome.permissions.contains({ permissions: [USER_SCRIPTS_PERMISSION] });
  return granted ? userScriptsApiState(chrome.userScripts) : 'no-permission';
}

// In the panel's own window, so the user comes back to this panel after turning the toggle on.
function openExtensionDetails(): void
{
  chrome.windows.getCurrent()
    .then(panelWindow => chrome.tabs.create({ windowId: panelWindow.id, url: `chrome://extensions/?id=${chrome.runtime.id}` }))
    .catch(error => console.error('[UserScriptsNotice] could not open the extension details:', error));
}
