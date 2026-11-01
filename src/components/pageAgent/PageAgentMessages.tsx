import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, Code, Copy, Loader2, Redo2, Undo2, X } from 'lucide-react';
import type { PageAgentChatData, PageAgentTurn, PageAgentTurnStatus } from '../../services/pageAgent/pageAgentChat';
import type { PageAgentStep } from '../../services/pageAgent/pageAgentRun';

interface PageAgentMessagesProps
{
  chat: PageAgentChatData | undefined;
  running: boolean;
  actionError: string | null;
  onUndo: () => void;
  onReapply: () => void;
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

/** The chat of one tab: user requests, the agent's turns, and the state of the applied stylesheet. */
export const PageAgentMessages: React.FC<PageAgentMessagesProps> = ({ chat, running, actionError, onUndo, onReapply }) =>
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
  }, [chat?.tabId, turns.length, lastTurn?.steps.length, lastTurn?.status, chat?.notice]);

  if (!chat)
  {
    return <div className="flex-1 min-h-0" />;
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
      {turns.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400">
          Ask for a change to this page, for example “make the video player full page width”. The agent
          sets measurable conditions, applies CSS, checks the result with real numbers and reports each
          condition. Undo removes everything it applied.
        </p>
      )}
      {turns.map((turn, index) => (
        <TurnView
          key={index}
          turn={turn}
          stylesheet={index === turns.length - 1 ? chat.appliedCss : ''}
          running={running}
          onUndo={onUndo}
        />
      ))}
      {chat.notice !== 'none' && (
        <div className="flex items-center gap-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 px-2 py-1.5">
          <span className="flex-1 text-amber-700 dark:text-amber-300">
            {chat.notice === 'reloaded' ? 'Page reloaded, changes removed' : 'Page changed, changes removed'}
          </span>
          {chat.notice === 'reloaded' && chat.appliedCss && (
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
  /** The chat's current stylesheet, given only to the last turn, which holds Undo and Show CSS. */
  stylesheet: string;
  running: boolean;
  onUndo: () => void;
}

const TurnView: React.FC<TurnViewProps> = ({ turn, stylesheet, running, onUndo }) =>
{
  const [showSteps, setShowSteps] = useState(false);
  const [showCss, setShowCss] = useState(false);
  const outcome = OUTCOME_STYLES[turn.status];
  const isRunning = turn.status === 'running';

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

        {turn.summary && <p className="whitespace-pre-wrap break-words">{turn.summary}</p>}
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

        {stylesheet && (
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
              <button type="button" className={buttonClass} onClick={() => setShowCss(!showCss)}>
                <Code size={12} />
                {showCss ? 'Hide CSS' : 'Show CSS'}
              </button>
            </div>
            {showCss && <CssBlock css={stylesheet} />}
          </div>
        )}
      </div>
    </div>
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
    {step.css && (
      <pre className="max-h-40 overflow-auto rounded bg-gray-100 dark:bg-gray-800 p-1 font-mono text-[0.85em] whitespace-pre-wrap break-all">
        {step.css}
      </pre>
    )}
    {step.screenshotDataUrl && (
      <img src={step.screenshotDataUrl} alt="Screenshot the agent took" className="max-w-full rounded border border-gray-200 dark:border-gray-700" />
    )}
  </li>
);

const CssBlock: React.FC<{ css: string }> = ({ css }) =>
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
    navigator.clipboard.writeText(css)
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
    <div className="relative">
      <pre className="max-h-48 overflow-auto rounded bg-gray-100 dark:bg-gray-800 p-1.5 pr-14 font-mono text-[0.85em] whitespace-pre-wrap break-all">
        {css}
      </pre>
      <button type="button" className={clsx(buttonClass, 'absolute top-1 right-1')} onClick={copy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
};
