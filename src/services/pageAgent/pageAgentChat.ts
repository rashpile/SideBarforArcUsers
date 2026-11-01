// The page agent chat of one tab: its turns (one per user message) and the stylesheet the agent
// applied last. The data inside is plain JSON, so the session store keeps it as is, minus the
// screenshots, which stay in side panel memory. Every change replaces the data object, so a React
// hook can tell a changed chat by identity.

import type {
  PageAgentAppliedCss,
  PageAgentConditionOutcome,
  PageAgentHistoryTurn,
  PageAgentReplacedCondition,
  PageAgentRunResult,
  PageAgentRunStatus,
  PageAgentStep,
} from './pageAgentRun.ts';
import type { PageAgentConditionSpec } from './pageAgentTools.ts';

export type PageAgentTurnStatus = 'running' | PageAgentRunStatus;

/** Set when the page dropped the applied stylesheet: a reload of the same URL, or another page. */
export type PageAgentNotice = 'none' | 'reloaded' | 'navigated';

export interface PageAgentTurn
{
  readonly request: string;
  readonly status: PageAgentTurnStatus;
  /** While the turn runs, the conditions set so far, all unmet with no measurement yet. */
  readonly conditions: readonly PageAgentConditionOutcome[];
  readonly replaced: readonly PageAgentReplacedCondition[];
  readonly steps: readonly PageAgentStep[];
  readonly summary: string;
  readonly error?: string;
  readonly screenshotsNote?: string;
}

export interface PageAgentChatData
{
  readonly tabId: number;
  readonly turns: readonly PageAgentTurn[];
  /** The sanitized stylesheet without the marker; Show CSS and Re-apply use it. */
  readonly appliedCss: string;
  /** The exact text last inserted, kept until it has been removed: removeCSS finds it only by text. */
  readonly appliedInsertedText: string;
  readonly appliedId: string;
  readonly appliedUrl: string;
  readonly notice: PageAgentNotice;
}

const NO_REPORT = 'no report';
const PANEL_CLOSED_SUMMARY = 'Side panel closed during the run.';
const NOTICES: readonly PageAgentNotice[] = ['none', 'reloaded', 'navigated'];

export class PageAgentChat
{
  #data: PageAgentChatData;

  constructor(data: PageAgentChatData)
  {
    this.#data = data;
  }

  static empty(tabId: number): PageAgentChat
  {
    return new PageAgentChat({
      tabId,
      turns: [],
      appliedCss: '',
      appliedInsertedText: '',
      appliedId: '',
      appliedUrl: '',
      notice: 'none',
    });
  }

  /**
   * A chat read back from storage, or null when the value isn't one. A turn stored as running has
   * no run any more: runs live in the side panel that started them, and loading happens only in a
   * panel that has no run on the tab yet.
   */
  static fromStored(value: unknown, tabId: number): PageAgentChat | null
  {
    if (!isRecord(value) || value.tabId !== tabId || !Array.isArray(value.turns))
    {
      return null;
    }
    const turns = value.turns.filter(isRecord).map(turn => stoppedIfRunning(turn as unknown as PageAgentTurn));
    return new PageAgentChat({
      tabId,
      turns,
      appliedCss: stringOrEmpty(value.appliedCss),
      appliedInsertedText: stringOrEmpty(value.appliedInsertedText),
      appliedId: stringOrEmpty(value.appliedId),
      appliedUrl: stringOrEmpty(value.appliedUrl),
      notice: NOTICES.find(notice => notice === value.notice) ?? 'none',
    });
  }

  get tabId(): number
  {
    return this.#data.tabId;
  }

  /** The same object until the chat changes. */
  get data(): PageAgentChatData
  {
    return this.#data;
  }

  get appliedCss(): string
  {
    return this.#data.appliedCss;
  }

  get appliedInsertedText(): string
  {
    return this.#data.appliedInsertedText;
  }

  get appliedId(): string
  {
    return this.#data.appliedId;
  }

  get appliedUrl(): string
  {
    return this.#data.appliedUrl;
  }

  get notice(): PageAgentNotice
  {
    return this.#data.notice;
  }

  turnStatus(turnIndex: number): PageAgentTurnStatus | undefined
  {
    return this.#data.turns[turnIndex]?.status;
  }

  /** Adds a running turn for a new user message and returns its index. */
  startTurn(request: string): number
  {
    const turn: PageAgentTurn = { request, status: 'running', conditions: [], replaced: [], steps: [], summary: '' };
    this.#update({ turns: [...this.#data.turns, turn] });
    return this.#data.turns.length - 1;
  }

  setConditions(
    turnIndex: number,
    conditions: readonly PageAgentConditionSpec[],
    replaced: readonly PageAgentReplacedCondition[],
  ): void
  {
    this.#updateTurn(turnIndex, turn => ({
      ...turn,
      conditions: conditions.map(condition => ({ id: condition.id, text: condition.text, met: false, measured: '' })),
      replaced: [...replaced],
    }));
  }

  addStep(turnIndex: number, step: PageAgentStep): void
  {
    this.#updateTurn(turnIndex, turn => ({ ...turn, steps: [...turn.steps, step] }));
  }

  finishTurn(turnIndex: number, result: PageAgentRunResult): void
  {
    this.#updateTurn(turnIndex, turn => ({
      ...turn,
      status: result.status,
      conditions: result.conditions,
      replaced: result.replaced,
      summary: result.summary,
      ...(result.error !== undefined && { error: result.error }),
      ...(result.screenshotsNote !== undefined && { screenshotsNote: result.screenshotsNote }),
    }));
  }

  /** Ends a turn whose run failed without reporting a result. */
  failTurn(turnIndex: number, error: string): void
  {
    this.#updateTurn(turnIndex, turn => ({ ...unreported(turn), status: 'error', error }));
  }

  /** The stylesheet now on the page; the page has it, so any notice is out of date. */
  recordApplied(applied: PageAgentAppliedCss): void
  {
    this.#update({
      appliedCss: applied.css,
      appliedInsertedText: applied.insertedText,
      appliedId: applied.appliedId,
      appliedUrl: applied.url,
      notice: 'none',
    });
  }

  /** After Undo removed the stylesheet. */
  clearApplied(): void
  {
    this.#update({ appliedCss: '', appliedInsertedText: '', appliedId: '', appliedUrl: '', notice: 'none' });
  }

  /** Returns whether the notice changed. */
  setNotice(notice: PageAgentNotice): boolean
  {
    if (this.#data.notice === notice)
    {
      return false;
    }
    this.#update({ notice });
    return true;
  }

  /** The finished turns, condensed for the first message of a follow-up run. */
  history(): PageAgentHistoryTurn[]
  {
    return this.#data.turns.map(turn => ({
      request: turn.request,
      status: turn.status,
      conditions: [...turn.conditions],
      replaced: [...turn.replaced],
      summary: turn.summary || (turn.error ? `Error: ${turn.error}` : ''),
    }));
  }

  /** The data to persist: screenshots stay in memory, as a session key would soon fill up with them. */
  toStored(): PageAgentChatData
  {
    return {
      ...this.#data,
      turns: this.#data.turns.map(turn => ({ ...turn, steps: turn.steps.map(withoutScreenshot) })),
    };
  }

  #update(changes: Partial<PageAgentChatData>): void
  {
    this.#data = { ...this.#data, ...changes };
  }

  #updateTurn(turnIndex: number, change: (turn: PageAgentTurn) => PageAgentTurn): void
  {
    const turn = this.#data.turns[turnIndex];
    if (!turn)
    {
      return;
    }
    const turns = [...this.#data.turns];
    turns[turnIndex] = change(turn);
    this.#update({ turns });
  }
}

function stoppedIfRunning(turn: PageAgentTurn): PageAgentTurn
{
  if (turn.status !== 'running')
  {
    return turn;
  }
  return { ...unreported(turn), status: 'stopped', summary: PANEL_CLOSED_SUMMARY };
}

// The conditions of a turn that ended without a report: none of them was checked.
function unreported(turn: PageAgentTurn): PageAgentTurn
{
  const conditions = (turn.conditions ?? []).map(condition => ({ ...condition, met: false, measured: NO_REPORT }));
  return { ...turn, conditions };
}

function withoutScreenshot(step: PageAgentStep): PageAgentStep
{
  if (step.screenshotDataUrl === undefined)
  {
    return step;
  }
  const { screenshotDataUrl: _image, ...rest } = step;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrEmpty(value: unknown): string
{
  return typeof value === 'string' ? value : '';
}
