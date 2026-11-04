import React from 'react';
import { Code, KeyRound, Loader2, Play, X } from 'lucide-react';
import { httpOriginOf, siteName } from '../../stores/savedPageStyles';
import { PAGE_AGENT_MARKER_PROPERTY, withMarker } from '../../utils/pageAgentCss';
import type { CodeDraft } from './codeDrafts';
import { UserScriptsNotice } from './UserScriptsNotice';

interface PageAgentCodeEditorProps
{
  draft: CodeDraft;
  /** The URL of the tab's page now, which may have left the draft's site. */
  tabUrl: string | undefined;
  running: boolean;
  /** Whether the extension may change http and https pages; null until known. */
  hasPageAccess: boolean | null;
  /** Why the style strip's last action failed; the chat shows it while the editor is closed. */
  actionError: string | null;
  onRequestPageAccess: () => void;
  onChange: (css: string, script: string) => void;
  /** Binds the draft to the site the tab is on now. */
  onRebind: (origin: string) => void;
  onApply: () => void;
  /** Shows a reason Apply refused in the draft's error line. */
  onError: (message: string) => void;
  onCancel: () => void;
}

const textareaClass = 'flex-1 min-h-[5em] w-full resize-none rounded border border-gray-300 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-800 px-1.5 py-1 font-mono text-[0.85em] outline-none focus:ring-2 focus:ring-blue-500 ' +
  'read-only:opacity-60';

const buttonClass = 'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const UNCLOSED_CSS = 'the CSS has an unclosed { or comment';

/**
 * CSS and JavaScript the user pastes or edits for the tab's page. Apply puts exactly this code on the
 * page as the chat's applied set; the CSS is the user's own, so it isn't checked for network loads.
 */
export const PageAgentCodeEditor: React.FC<PageAgentCodeEditorProps> = ({
  draft,
  tabUrl,
  running,
  hasPageAccess,
  actionError,
  onRequestPageAccess,
  onChange,
  onRebind,
  onApply,
  onError,
  onCancel,
}) =>
{
  const site = siteName(draft.origin);
  const tabOrigin = httpOriginOf(tabUrl ?? '');
  const otherSite = tabOrigin !== draft.origin;
  const hasScript = draft.script.trim() !== '';

  let applyTitle = 'Put this CSS and script on the page in place of what is applied now';
  if (running)
  {
    applyTitle = 'Wait until the agent has finished';
  }
  else if (otherSite)
  {
    applyTitle = `The code was opened for ${site}; this tab is on another site now`;
  }

  const apply = () =>
  {
    if (!cssKeepsMarker(draft.css))
    {
      onError(UNCLOSED_CSS);
      return;
    }
    onApply();
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 border-t border-gray-200 dark:border-gray-700 px-2 py-1.5">
      <div className="shrink-0 flex items-center gap-1.5 font-medium">
        <Code size={12} className="shrink-0 text-blue-500" />
        <span className="min-w-0 truncate">Code for {site}</span>
      </div>

      {otherSite && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 px-2 py-1.5">
          <span className="flex-1 text-amber-700 dark:text-amber-300">
            {tabOrigin === null
              ? `This tab has no http or https page now; the code was opened for ${site}.`
              : `This tab is on ${siteName(tabOrigin)} now; the code was opened for ${site}.`}
          </span>
          {tabOrigin !== null && (
            <button type="button" className={buttonClass} disabled={draft.applying} onClick={() => onRebind(tabOrigin)}>
              Use on {siteName(tabOrigin)}
            </button>
          )}
        </div>
      )}

      <label className="flex-1 min-h-0 flex flex-col gap-0.5">
        <span className="text-[0.85em] font-medium text-gray-500 dark:text-gray-400">CSS</span>
        <textarea
          value={draft.css}
          onChange={event => onChange(event.target.value, draft.script)}
          readOnly={draft.applying}
          spellCheck={false}
          placeholder="body { font-size: 18px !important; }"
          className={textareaClass}
        />
      </label>
      <p className="shrink-0 text-[0.85em] text-gray-500 dark:text-gray-400">
        Your CSS isn’t checked: fonts, images and @import it names load from the network.
      </p>

      <label className="flex-1 min-h-0 flex flex-col gap-0.5">
        <span className="text-[0.85em] font-medium text-gray-500 dark:text-gray-400">Script</span>
        <textarea
          value={draft.script}
          onChange={event => onChange(draft.css, event.target.value)}
          readOnly={draft.applying}
          spellCheck={false}
          placeholder="agent.on(document, 'keydown', event => { … });"
          className={textareaClass}
        />
      </label>
      <p className="shrink-0 text-[0.85em] text-gray-500 dark:text-gray-400">
        A script runs with your login on {site}, so run only code you trust. It runs in the extension’s own
        world: it sees the page’s DOM but not the page’s JavaScript variables, loads from the network only from
        the page’s own site, and can’t use import. Undo removes what it registers through agent.on,
        agent.setInterval, agent.setTimeout, agent.observe, agent.add and agent.onUndo; anything else stays
        until a reload.
      </p>

      {hasScript && (
        <div className="shrink-0">
          <UserScriptsNotice context="editor" />
        </div>
      )}
      {hasPageAccess === false && (
        <div className="shrink-0 flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <span className="flex-1">The extension needs access to http and https pages to change them.</span>
          <button type="button" onClick={onRequestPageAccess} className={buttonClass}>
            <KeyRound size={12} />
            Grant page access
          </button>
        </div>
      )}
      {actionError && <p className="shrink-0 text-red-600 dark:text-red-400 break-words">{actionError}</p>}
      {draft.error && <p className="shrink-0 text-red-600 dark:text-red-400 break-words">{draft.error}</p>}

      <div className="shrink-0 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={apply}
          disabled={running || draft.applying || otherSite}
          title={applyTitle}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {draft.applying ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {draft.applying ? 'Applying…' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={draft.applying}
          title="Close the editor; what is applied stays on the page"
          className={buttonClass}
        >
          <X size={12} />
          Cancel
        </button>
      </div>
    </div>
  );
};

/**
 * Whether the marker rule appended after the CSS stays a top-level rule of its own. An unclosed block
 * or comment would swallow it: the page would keep the CSS while the panel reads no marker and tells
 * the user the page dropped it. replaceSync drops @import rules, which doesn't matter here.
 */
function cssKeepsMarker(css: string): boolean
{
  const sheet = new CSSStyleSheet();
  try
  {
    sheet.replaceSync(withMarker(css, 'check'));
  }
  catch
  {
    return false;
  }
  const last = sheet.cssRules[sheet.cssRules.length - 1];
  return last instanceof CSSStyleRule &&
    last.selectorText === ':root' &&
    last.style.getPropertyValue(PAGE_AGENT_MARKER_PROPERTY) !== '';
}
