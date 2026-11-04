import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AppWindow, Check, Code, Copy, Loader2, Redo2, Save, Undo2, X } from 'lucide-react';
import type { PageAgentChatData, PageAgentTurn, PageAgentTurnStatus } from '../../services/pageAgent/pageAgentChat';
import type { PageAgentScriptRequest, PageAgentStep } from '../../services/pageAgent/pageAgentRun';
import { siteName } from '../../stores/savedPageStyles';
import type { SavedPageStyle } from '../../stores/savedPageStyles';
import { parseMarkdown } from '../../utils/markdown';
import { MarkdownView } from './MarkdownView';

interface PageAgentMessagesProps
{
  chat: PageAgentChatData | undefined;
  running: boolean;
  actionError: string | null;
  /** Whether the tab was opened from a bookmark or Favorite, which its style can be saved to. */
  hasBookmark: boolean;
  /** The style saved to that bookmark, or null. */
  savedStyle: SavedPageStyle | null;
  /** Answers the script approval the running turn waits for. */
  onApproveScripts: (allow: boolean) => void;
  onUndo: () => void;
  onReapply: () => void;
  /** Saves the chat's applied CSS and script to the tab's bookmark. */
  onSave: () => void;
  /** Shows an answered turn's answer in a popup on the page. */
  onShowOnPage: (turnIndex: number) => void;
}

/**
 * What Save can do with the chat's CSS and script. Compared by their text, not by applied id: right
 * after a save the sheet on the page still carries the run's id.
 */
type SaveState = 'no-bookmark' | 'new' | 'update' | 'saved';

function saveState(hasBookmark: boolean, savedStyle: SavedPageStyle | null, css: string, script: string): SaveState
{
  if (!hasBookmark)
  {
    return 'no-bookmark';
  }
  if (!savedStyle)
  {
    return 'new';
  }
  return savedStyle.holds(css, script) ? 'saved' : 'update';
}

interface OutcomeStyle
{
  label: string;
  block: string;
  title: string;
}

const OUTCOME_STYLES: Record<PageAgentTurnStatus, OutcomeStyle> = {
  'running': {
    label: 'Working…',
    block: 'border-blue-200 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30',
    title: 'text-blue-700 dark:text-blue-300',
  },
  'met': {
    label: 'All conditions met',
    block: 'border-green-200 bg-green-50/60 dark:border-green-800 dark:bg-green-950/30',
    title: 'text-green-700 dark:text-green-300',
  },
  'not-met': {
    label: 'Not all conditions met',
    block: 'border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30',
    title: 'text-amber-700 dark:text-amber-300',
  },
  'answered': {
    label: 'Answer',
    block: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50',
    title: 'text-gray-700 dark:text-gray-200',
  },
  'stopped': {
    label: 'Stopped',
    block: 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50',
    title: 'text-gray-600 dark:text-gray-300',
  },
  'error': {
    label: 'Error',
    block: 'border-red-200 bg-red-50/60 dark:border-red-800 dark:bg-red-950/30',
    title: 'text-red-700 dark:text-red-300',
  },
};

const buttonClass = 'inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed';

/** The chat of one tab: user requests, the agent's turns, and the state of the applied CSS and script. */
export const PageAgentMessages: React.FC<PageAgentMessagesProps> = ({
  chat,
  running,
  actionError,
  hasBookmark,
  savedStyle,
  onApproveScripts,
  onUndo,
  onReapply,
  onSave,
  onShowOnPage,
}) =>
{
  const scrollRef = useRef<HTMLDivElement>(null);
  const turns = chat?.turns ?? [];
  const lastTurn = turns[turns.length - 1];

  // Follows the run as it adds steps and ends; expanding an older turn's steps doesn't jump.
  useEffect(() =>
  {
    const container = scrollRef.current;
    if (container)
    {
      container.scrollTop = container.scrollHeight;
    }
  }, [chat?.tabId, turns.length, lastTurn?.steps.length, lastTurn?.status, lastTurn?.pendingScript, chat?.notice]);

  if (!chat)
  {
    return <div className="flex-1 min-h-0" />;
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
      {turns.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400">
          Ask a question about this page, for example “summarize this page”, or ask for a change, for
          example “make the video player full page width”. For a change the agent sets measurable
          conditions, applies CSS, checks the result with real numbers and reports each condition. Undo
          removes everything it applied.
        </p>
      )}
      {/* A saved style the chat adopted on a fresh tab has no turn to hold Undo and Show code. */}
      {turns.length === 0 && (chat.appliedCss || chat.appliedScript) && (
        <AppliedActions css={chat.appliedCss} script={chat.appliedScript} running={running} onUndo={onUndo} />
      )}
      {turns.map((turn, index) => (
        <TurnView
          key={index}
          turn={turn}
          appliedCss={index === turns.length - 1 ? chat.appliedCss : ''}
          appliedScript={index === turns.length - 1 ? chat.appliedScript : ''}
          running={running}
          saveState={saveState(hasBookmark, savedStyle, chat.appliedCss, chat.appliedScript)}
          onApproveScripts={onApproveScripts}
          onUndo={onUndo}
          onSave={onSave}
          onShowOnPage={() => onShowOnPage(index)}
        />
      ))}
      {chat.notice !== 'none' && (
        <div className="flex items-center gap-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 px-2 py-1.5">
          <span className="flex-1 text-amber-700 dark:text-amber-300">
            {chat.notice === 'reloaded' ? 'Page reloaded, changes removed' : 'Page changed, changes removed'}
          </span>
          {chat.notice !== 'navigated-other-site' && (chat.appliedCss || chat.appliedScript) && (
            <button type="button" className={buttonClass} disabled={running} onClick={onReapply}>
              <Redo2 size={12} />
              Re-apply
            </button>
          )}
        </div>
      )}
      {actionError && <p className="text-red-600 dark:text-red-400">{actionError}</p>}
    </div>
  );
};

interface TurnViewProps
{
  turn: PageAgentTurn;
  /** The chat's applied CSS and script, given only to the last turn, which holds Undo, Show code and Save. */
  appliedCss: string;
  appliedScript: string;
  running: boolean;
  saveState: SaveState;
  onApproveScripts: (allow: boolean) => void;
  onUndo: () => void;
  onSave: () => void;
  onShowOnPage: () => void;
}

const TurnView: React.FC<TurnViewProps> = ({
  turn,
  appliedCss,
  appliedScript,
  running,
  saveState,
  onApproveScripts,
  onUndo,
  onSave,
  onShowOnPage,
}) =>
{
  const [showSteps, setShowSteps] = useState(false);
  const outcome = OUTCOME_STYLES[turn.status];
  const isRunning = turn.status === 'running';
  const isAnswer = turn.status === 'answered';
  // Every step of a run re-renders the whole chat; older answers keep their parsed tree.
  const answerBlocks = useMemo(() => (isAnswer ? parseMarkdown(turn.summary) : null), [isAnswer, turn.summary]);

  return (
    <div className="space-y-1.5">
      <div className="ml-6 rounded-lg bg-blue-500 text-white px-2 py-1.5 whitespace-pre-wrap break-words">
        {turn.request}
      </div>

      <div className={clsx('rounded-lg border px-2 py-1.5 space-y-1.5', outcome.block)}>
        <div className={clsx('flex items-center gap-1.5 font-medium', outcome.title)}>
          {isRunning && <Loader2 size={12} className="animate-spin shrink-0" />}
          {turn.status === 'not-met' && turn.conditions.length === 0 ? 'Not done' : outcome.label}
        </div>

        {turn.conditions.length > 0 && (
          <ul className="space-y-0.5">
            {turn.conditions.map((condition, index) => (
              <li key={index} className="flex gap-1.5">
                <ConditionMark pending={isRunning} met={condition.met} />
                <span className="min-w-0 break-words">
                  {condition.text}
                  {condition.measured && (
                    <span className="text-gray-500 dark:text-gray-400"> · {condition.measured}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {turn.replaced.length > 0 && (
          <ul className="space-y-0.5">
            {turn.replaced.map((entry, index) => (
              <li key={index} className="flex gap-1.5 text-gray-500 dark:text-gray-400">
                <span className="shrink-0 w-3 text-center" aria-label="replaced">↷</span>
                <span className="min-w-0 break-words">
                  {entry.text || entry.id}
                  <span> · replaced: {entry.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {answerBlocks
          ? <MarkdownView blocks={answerBlocks} />
          : turn.summary && <p className="whitespace-pre-wrap break-words">{turn.summary}</p>}
        {turn.error && <p className="text-red-600 dark:text-red-400 break-words">{turn.error}</p>}
        {turn.screenshotsNote && <p className="text-gray-500 dark:text-gray-400">{turn.screenshotsNote}</p>}

        {turn.steps.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowSteps(!showSteps)}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              {turn.steps.length} {turn.steps.length === 1 ? 'step' : 'steps'} · {showSteps ? 'hide steps' : 'show steps'}
            </button>
            {showSteps && (
              <ol className="mt-1 space-y-1">
                {turn.steps.map((step, index) => <StepView key={index} step={step} />)}
              </ol>
            )}
          </div>
        )}

        {isRunning && turn.pendingScript && (
          <ScriptApproval request={turn.pendingScript} onAnswer={onApproveScripts} />
        )}

        {/* Not disabled by a run: showing an answer touches only the popup, never the stylesheet. */}
        {isAnswer && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={buttonClass} title="Show this answer in a popup on the page" onClick={onShowOnPage}>
              <AppWindow size={12} />
              Show on page
            </button>
          </div>
        )}

        {(appliedCss || appliedScript) && (
          <AppliedActions css={appliedCss} script={appliedScript} running={running} onUndo={onUndo}>
            <SaveButton state={saveState} hasScript={appliedScript !== ''} running={running} onSave={onSave} />
          </AppliedActions>
        )}
      </div>
    </div>
  );
};

/**
 * The run waits on this: the first script of a request runs only once the user allows it, and the
 * answer holds for the request's other scripts on the same site. Stop still ends the run.
 */
const ScriptApproval: React.FC<{ request: PageAgentScriptRequest; onAnswer: (allow: boolean) => void }> = ({ request, onAnswer }) =>
{
  const site = siteName(request.origin);
  return (
    <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-1.5 space-y-1.5">
      <div className="font-medium text-amber-800 dark:text-amber-200">The agent wants to run JavaScript on {site}</div>
      <p className="text-gray-600 dark:text-gray-300">
        {request.kind === 'check'
          ? 'A check: it reads the page and removes what it added when it returns.'
          : 'It stays on the page until Undo or a reload.'}
        {' '}Allow also runs the agent’s other scripts on {site} until this request ends, without showing them
        first. Deny if the code does anything you didn’t ask for, such as opening another site, sending data,
        submitting a form or clicking a button; Deny refuses every script of this request.
      </p>
      <pre className="max-h-48 overflow-auto rounded bg-white dark:bg-gray-900 p-1.5 font-mono text-[0.85em] whitespace-pre-wrap break-all">
        {request.code}
      </pre>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600"
          onClick={() => onAnswer(true)}
        >
          <Check size={12} />
          Allow
        </button>
        <button type="button" className={buttonClass} onClick={() => onAnswer(false)}>
          <X size={12} />
          Deny
        </button>
      </div>
    </div>
  );
};

interface AppliedActionsProps
{
  css: string;
  script: string;
  running: boolean;
  onUndo: () => void;
  /** More buttons for the row, after Undo and Show code. */
  children?: React.ReactNode;
}

const AppliedActions: React.FC<AppliedActionsProps> = ({ css, script, running, onUndo, children }) =>
{
  const [showCode, setShowCode] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={buttonClass}
          disabled={running}
          title={running ? 'Wait until the agent has finished' : 'Remove everything the agent applied'}
          onClick={onUndo}
        >
          <Undo2 size={12} />
          Undo
        </button>
        <button type="button" className={buttonClass} onClick={() => setShowCode(!showCode)}>
          <Code size={12} />
          {showCode ? 'Hide code' : 'Show code'}
        </button>
        {children}
      </div>
      {showCode && css && <CodeBlock label="CSS" code={css} />}
      {showCode && script && <CodeBlock label="Script" code={script} />}
    </div>
  );
};

interface SaveButtonProps
{
  state: SaveState;
  /** The applied set has a script, which Auto-apply then runs on every load without asking. */
  hasScript: boolean;
  running: boolean;
  onSave: () => void;
}

const SaveButton: React.FC<SaveButtonProps> = ({ state, hasScript, running, onSave }) =>
{
  if (state === 'saved')
  {
    return (
      <button type="button" className={buttonClass} disabled title="The bookmark’s saved style is what is applied now">
        <Check size={12} />
        Saved
      </button>
    );
  }

  const label = state === 'update' ? 'Update saved style' : 'Save to bookmark';
  let title: string;
  if (state === 'no-bookmark')
  {
    title = 'Open this page from a bookmark to save its style';
  }
  else if (running)
  {
    title = 'Wait until the agent has finished';
  }
  else
  {
    title = state === 'update'
      ? 'Replace the bookmark’s saved style with what is applied now'
      : 'Save what is applied to the bookmark and apply it whenever a page of this site loads in the bookmark’s tab';
    // The saved script may be a later one than the user allowed: Allow covers the request's other scripts.
    if (hasScript)
    {
      title += '. The script runs on every load without asking: check it with Show code first';
    }
  }

  return (
    <button type="button" className={buttonClass} disabled={running || state === 'no-bookmark'} title={title} onClick={onSave}>
      <Save size={12} />
      {label}
    </button>
  );
};

const ConditionMark: React.FC<{ pending: boolean; met: boolean }> = ({ pending, met }) =>
{
  if (pending)
  {
    return <span className="shrink-0 w-3 text-center text-gray-400" aria-label="pending">•</span>;
  }
  return met
    ? <Check size={12} className="shrink-0 mt-[0.2em] text-green-600 dark:text-green-400" aria-label="met" />
    : <X size={12} className="shrink-0 mt-[0.2em] text-red-600 dark:text-red-400" aria-label="unmet" />;
};

const StepView: React.FC<{ step: PageAgentStep }> = ({ step }) => (
  <li className="rounded bg-white/70 dark:bg-gray-900/50 px-1.5 py-1 space-y-1">
    <div className="break-words">
      <span className="font-mono">{step.tool}</span>
      {step.args && <span className="text-gray-500 dark:text-gray-400"> ({step.args})</span>}
      {step.result && <span className="text-gray-500 dark:text-gray-400"> → {step.result}</span>}
    </div>
    {step.css && <StepCode code={step.css} />}
    {step.script && <StepCode code={step.script} />}
    {step.screenshotDataUrl && (
      <img src={step.screenshotDataUrl} alt="Screenshot the agent took" className="max-w-full rounded border border-gray-200 dark:border-gray-700" />
    )}
  </li>
);

const StepCode: React.FC<{ code: string }> = ({ code }) => (
  <pre className="max-h-40 overflow-auto rounded bg-gray-100 dark:bg-gray-800 p-1 font-mono text-[0.85em] whitespace-pre-wrap break-all">
    {code}
  </pre>
);

const CodeBlock: React.FC<{ label: string; code: string }> = ({ label, code }) =>
{
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () =>
  {
    if (timerRef.current)
    {
      clearTimeout(timerRef.current);
    }
  }, []);

  const copy = () =>
  {
    navigator.clipboard.writeText(code)
      .then(() =>
      {
        setCopied(true);
        if (timerRef.current)
        {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(error => console.error('[PageAgentMessages] copy failed:', error));
  };

  return (
    <div className="space-y-0.5">
      <div className="text-[0.85em] font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className="relative">
        <pre className="max-h-48 overflow-auto rounded bg-gray-100 dark:bg-gray-800 p-1.5 pr-14 font-mono text-[0.85em] whitespace-pre-wrap break-all">
          {code}
        </pre>
        <button type="button" className={clsx(buttonClass, 'absolute top-1 right-1')} onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
};
