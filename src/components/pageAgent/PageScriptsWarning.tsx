import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface PageScriptsWarningProps
{
  /** Called from the click itself, so the permission request it makes counts as a user gesture. */
  onTurnOn: () => void;
  onCancel: () => void;
}

/**
 * Shown when the user ticks Page scripts, before the switch goes on. Chrome grants the userScripts
 * permission without a prompt of its own, so this is the only place the risks are spelled out.
 */
export const PageScriptsWarning: React.FC<PageScriptsWarningProps> = ({ onTurnOn, onCancel }) => (
  <div className="mt-1 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-1.5 space-y-1.5">
    <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
      <ShieldAlert size={14} className="shrink-0" />
      Turn on Page scripts?
    </div>
    <ul className="list-disc pl-4 space-y-1 text-gray-600 dark:text-gray-300">
      <li>
        A script runs with your login on the site. It can read everything on the page, such as messages and
        form fields, and click buttons or submit forms as you.
      </li>
      <li>
        Web pages can hide instructions for the AI. The agent may follow them and write a script that does
        something you didn’t ask for.
      </li>
      <li>
        You see only the first script of a request. Allow also runs the agent’s other scripts of that request
        on the same site, and a script you save runs on every load without asking.
      </li>
      <li>
        Use it on sites you trust. Avoid pages where other people’s content sits next to your private data,
        such as email, chats, comments and admin panels.
      </li>
    </ul>
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={onTurnOn}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700"
      >
        Turn on
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        Cancel
      </button>
    </div>
  </div>
);
