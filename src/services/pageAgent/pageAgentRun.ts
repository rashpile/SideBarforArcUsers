// One run of the page agent: the tool-call loop for one user message on one tab. The model client
// and the page adapter are passed in, so Node tests drive the loop with fakes; nothing in here
// touches chrome.*. The tab id is fixed when the run is created and every adapter call gets it,
// so a run keeps acting on its own tab whichever tab the user switches to.

import { httpOriginOf } from '../../stores/savedPageStyles.ts';
import { PageAgentCssSanitizer, withMarker } from '../../utils/pageAgentCss.ts';
import { PageAgentScriptCheck } from '../../utils/pageAgentScript.ts';
import type { PageAgentPluginResult, PageAgentToolPlugin } from './pageAgentPlugin.ts';
import {
  PAGE_AGENT_MAX_ROUNDS,
  PAGE_AGENT_TOOL_NAMES,
  pageAgentSystemPrompt,
  pageAgentToolDefinitions,
  parseApplyCssArgs,
  parseInspectArgs,
  parseReportArgs,
  parseScriptArgs,
  parseSetConditionsArgs,
  parseShowPopupArgs,
} from './pageAgentTools.ts';
import type {
  PageAgentConditionSpec,
  PageAgentReportEntry,
  PageAgentToolDefinition,
} from './pageAgentTools.ts';
import type { UserScriptCommand, UserScriptResult } from './userScriptRuntime.ts';

export interface PageAgentToolCall
{
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type PageAgentContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface PageAgentAssistantMessage
{
  role: 'assistant';
  content: string | null;
  tool_calls?: PageAgentToolCall[];
}

export type PageAgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | PageAgentContentPart[] }
  | PageAgentAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

export interface PageAgentModelRequest
{
  messages: PageAgentMessage[];
  tools: PageAgentToolDefinition[];
  /** When set, the model must call this tool instead of choosing one. */
  toolChoice?: string;
}

/** Takes and returns the Chat Completions shape; a client for another API translates it. */
export interface PageAgentModelClient
{
  complete(request: PageAgentModelRequest, signal: AbortSignal): Promise<PageAgentAssistantMessage>;
}

/** A failed model request; `status` is the HTTP status when the API answered. */
export class PageAgentModelError extends Error
{
  readonly status: number | undefined;

  constructor(message: string, status?: number)
  {
    super(message);
    this.name = 'PageAgentModelError';
    this.status = status;
  }
}

export type PageAgentCapture = { dataUrl: string } | { unavailable: string };

/** An answer the agent gave, under the user request it answers. */
export interface PageAgentAnswer
{
  question: string;
  markdown: string;
}

/** Everything the run does to a page. Rejections end the run as `error`, except `showPopup`'s. */
export interface PageAgentPageAdapter
{
  /** JSON text for the model, already capped. */
  outline(tabId: number): Promise<string>;
  /** JSON text for the model. */
  inspect(tabId: number, selectors: string[]): Promise<string>;
  /** JSON text for the model: the page's readable text, already capped. */
  readText(tabId: number): Promise<string>;
  /** Replaces any popup on the page with one holding this answer. A rejection still ends the run `answered`. */
  showPopup(tabId: number, title: string, answer: PageAgentAnswer): Promise<void>;
  insertCss(tabId: number, text: string): Promise<void>;
  /** Removes an inserted stylesheet by its exact text; a no-op when the page no longer has it. */
  removeCss(tabId: number, text: string): Promise<void>;
  capture(tabId: number): Promise<PageAgentCapture>;
  pageUrl(tabId: number): Promise<string>;
  /**
   * Runs the command in the user script world of the tab's page origin. Rejects when the page has
   * none (not http or https) or Chrome blocks user scripts.
   */
  runUserScript(tabId: number, command: UserScriptCommand): Promise<UserScriptResult>;
}

export interface PageAgentConditionOutcome
{
  id: string;
  text: string;
  met: boolean;
  measured: string;
}

export interface PageAgentReplacedCondition
{
  id: string;
  /** Text of the earlier condition; empty when the chat history doesn't have the id. */
  text: string;
  reason: string;
}

/** `answered`: the turn answered a question (or asked one) and changed nothing; `summary` holds the answer. */
export type PageAgentRunStatus = 'met' | 'not-met' | 'answered' | 'stopped' | 'error';

export interface PageAgentRunResult
{
  status: PageAgentRunStatus;
  conditions: PageAgentConditionOutcome[];
  replaced: PageAgentReplacedCondition[];
  summary: string;
  error?: string;
  screenshotsNote?: string;
  /** The answer is already in a popup on the run's tab, from show_popup. */
  openedPopup?: boolean;
}

export interface PageAgentStep
{
  tool: string;
  args: string;
  result: string;
  css?: string;
  /** The code of apply_script or run_check, cut at a length it notes. */
  script?: string;
  /** Kept in side panel memory only; never persisted. */
  screenshotDataUrl?: string;
}

/** The CSS and script on the page: one set under one marker id. */
export interface PageAgentApplied
{
  /** The stylesheet without the marker, sanitized unless `cssByUser`; empty when only a script is applied. */
  css: string;
  /** The script running in the page's user script world; empty when there is none. */
  script: string;
  /** The exact text inserted into the page; removeCSS needs it. */
  insertedText: string;
  appliedId: string;
  url: string;
  /**
   * The CSS came from the user's code editor, so it is held to the size cap alone. Set only by the
   * editor's Apply; the agent's apply_css clears it.
   */
  cssByUser: boolean;
}

/** A script the run asks the user to approve before it runs. */
export interface PageAgentScriptRequest
{
  kind: 'apply' | 'check';
  code: string;
  /** The page's origin when the run asked; the answer holds only on pages of this origin. */
  origin: string;
}

export interface PageAgentRunListener
{
  onStep(step: PageAgentStep): void;
  onConditions(conditions: PageAgentConditionSpec[], replaced: PageAgentReplacedCondition[]): void;
  onApplied(applied: PageAgentApplied): void;
  /** Asked before the run's first script only: the answer holds for every script of the run on the same site. */
  onScriptApproval(request: PageAgentScriptRequest): Promise<boolean>;
  onFinished(result: PageAgentRunResult): void;
}

/** An earlier turn of the chat, condensed for a follow-up request. */
export interface PageAgentHistoryTurn
{
  request: string;
  status: PageAgentRunStatus | 'running';
  conditions: PageAgentConditionOutcome[];
  replaced: PageAgentReplacedCondition[];
  summary: string;
}

export interface PageAgentRunOptions
{
  tabId: number;
  request: string;
  client: PageAgentModelClient;
  adapter: PageAgentPageAdapter;
  listener: PageAgentRunListener;
  /** "Model accepts images": the screenshot tool is offered. */
  screenshots: boolean;
  /** The Page scripts switch is on and Chrome allows user scripts: apply_script and run_check are offered. */
  scripts: boolean;
  /** The enabled plugins; their tools are offered after the core tools. */
  plugins?: readonly PageAgentToolPlugin[];
  history?: readonly PageAgentHistoryTurn[];
  /** The stylesheet the chat applied last, without the marker; the model edits it. */
  currentCss?: string;
  /** `currentCss` was written by the user, not by apply_css. */
  currentCssByUser?: boolean;
  /** The script the chat applied last; it stays on the page while the run changes only the CSS. */
  currentScript?: string;
  /** The exact text inserted last, removed before the next insert; empty when there is none. */
  insertedText?: string;
  createId?: () => string;
  debug?: boolean;
}

const SCREENSHOT_OMITTED = '[screenshot omitted]';
const SCREENSHOTS_REJECTED = 'screenshots unavailable: the API rejected images';
const SCREENSHOTS_REJECTED_NOTE = 'Screenshots were turned off for this request: the API rejected images.';
const NO_REPORT = 'no report';
const NOT_REPORTED = 'not reported';
const NO_ANSWER = 'The model gave no answer.';
const SCRIPTS_OFF = 'refused: scripts are off; change the page with CSS';
const SCRIPTS_DECLINED = 'refused: the user declined to run scripts for this request; continue without scripts';
const SCRIPTS_NO_SITE = 'refused: scripts run only on http and https pages';
const STEP_TEXT_LIMIT = 500;
const STEP_SCRIPT_LIMIT = 8000;

/**
 * The user's answer to the run's first script and the site it was asked on. A script can navigate
 * the tab, and the page agent may script every http(s) site, so an answer given on one site must not
 * let later scripts of the request run unseen on another one, with the user's login there.
 */
class RunScriptApproval
{
  readonly origin: string;
  readonly answer: Promise<boolean>;

  constructor(origin: string, answer: Promise<boolean>)
  {
    this.origin = origin;
    this.answer = answer;
  }

  covers(origin: string | null): boolean
  {
    return origin === this.origin;
  }

  otherSiteRefusal(origin: string | null): string
  {
    const now = origin ?? 'a page that is not http or https';
    return `refused: the tab is on ${now} now, and the user allowed scripts only on ${this.origin}; `
      + `scripts run only on ${this.origin} for the rest of this request`;
  }
}

class RunStoppedError extends Error
{
  constructor()
  {
    super('The run was stopped');
    this.name = 'RunStoppedError';
  }
}

/** The conditions set in this run; a follow-up request starts with none. */
class RunConditions
{
  #conditions: PageAgentConditionSpec[] = [];
  #replaced: PageAgentReplacedCondition[] = [];

  get isSet(): boolean
  {
    return this.#conditions.length > 0;
  }

  get replaced(): PageAgentReplacedCondition[]
  {
    return [...this.#replaced];
  }

  /**
   * Only the first list of a run counts; false when the run has one. A later list could drop a
   * condition the model failed to meet, and the run would then end met on an easier list.
   */
  set(conditions: PageAgentConditionSpec[], replaced: PageAgentReplacedCondition[]): boolean
  {
    if (this.isSet)
    {
      return false;
    }
    this.#conditions = [...conditions];
    this.#replaced = [...replaced];
    return true;
  }

  /** A condition the report leaves out counts as unmet: silence is not success. */
  fromReport(results: readonly PageAgentReportEntry[]): PageAgentConditionOutcome[]
  {
    return this.#conditions.map(condition =>
    {
      const result = results.find(entry => entry.id === condition.id);
      return result
        ? { id: condition.id, text: condition.text, met: result.met, measured: result.measured }
        : { id: condition.id, text: condition.text, met: false, measured: NOT_REPORTED };
    });
  }

  allUnmet(measured: string): PageAgentConditionOutcome[]
  {
    return this.#conditions.map(condition => ({ id: condition.id, text: condition.text, met: false, measured }));
  }
}

/**
 * Whether the model has seen values measured after its last change to the page (apply_css or
 * apply_script). Tool results reach the model only with the next request, so a measurement (inspect
 * or a compiled run_check) in the same response as the report doesn't count: the report's numbers
 * would be written before the model saw any.
 */
class ChangeMeasurement
{
  /** The tools the run's texts name; without scripts only the CSS ones, as the model has no others. */
  readonly changeTools: string;
  readonly measureTools: string;
  /** What a condition's measured text calls the last change. */
  readonly lastChange: string;
  #changed = false;
  #measuredRound: number | undefined;

  constructor(scripts: boolean)
  {
    const names = PAGE_AGENT_TOOL_NAMES;
    this.changeTools = scripts ? `${names.applyCss} or ${names.applyScript}` : names.applyCss;
    this.measureTools = scripts ? `${names.inspect} or ${names.runCheck}` : names.inspect;
    this.lastChange = scripts ? 'change' : 'CSS change';
  }

  changed(): void
  {
    this.#changed = true;
    this.#measuredRound = undefined;
  }

  measured(round: number): void
  {
    this.#measuredRound ??= round;
  }

  /** True when the run changed nothing, or a measurement after the last change ran in an earlier response. */
  seenBefore(round: number): boolean
  {
    return !this.#changed || (this.#measuredRound !== undefined && this.#measuredRound < round);
  }
}

class ChatHistory
{
  readonly #turns: readonly PageAgentHistoryTurn[];

  constructor(turns: readonly PageAgentHistoryTurn[])
  {
    this.#turns = turns;
  }

  /** The text of an earlier condition, from the latest turn that has the id. */
  conditionText(id: string): string
  {
    for (let index = this.#turns.length - 1; index >= 0; index--)
    {
      const condition = this.#turns[index].conditions.find(entry => entry.id === id);
      if (condition)
      {
        return condition.text;
      }
    }
    return '';
  }

  /**
   * The first user message of a run. Earlier tool calls are not resent; the condensed turns and
   * the current stylesheet and script are enough for "a bit narrower" to edit the current result.
   */
  firstUserMessage(
    request: string,
    currentCss: string,
    currentScript: string,
    scripts: boolean,
    cssByUser: boolean,
  ): string
  {
    const sections = [`Request: ${request}`];
    if (this.#turns.length > 0)
    {
      const turns = this.#turns.map((turn, index) => describeTurn(turn, index + 1));
      sections.push(`Earlier requests in this chat (their tool calls are not repeated):\n${turns.join('\n')}`);
    }
    if (currentCss.trim())
    {
      // The user's CSS may hold what apply_css refuses; told so, the model leaves it out of its next
      // stylesheet instead of resending it into a rejection.
      const label = cssByUser
        ? 'Current stylesheet (written by the user; it may use url(), @import, image-set() or var(), which apply_css refuses, so a new apply_css replaces it as a whole without them)'
        : 'Current stylesheet (on the page now; a new apply_css replaces it as a whole)';
      sections.push(`${label}:\n${currentCss}`);
    }
    else if (this.#turns.length > 0)
    {
      sections.push('No stylesheet is applied now.');
    }
    if (scripts)
    {
      if (currentScript.trim())
      {
        sections.push(`Current script (on the page now; a new apply_script replaces it as a whole):\n${currentScript}`);
      }
      else if (this.#turns.length > 0)
      {
        sections.push('No script is applied now.');
      }
    }
    else if (currentScript.trim())
    {
      // Without the code: the model can't change the script, and apply_css keeps it running.
      sections.push('A script is applied on the page; scripts are off for this request, so leave it as it is.');
    }
    return sections.join('\n\n');
  }
}

/** The messages of one run, and the view of them that goes into each request. */
class RunConversation
{
  readonly #messages: PageAgentMessage[];
  #pendingScreenshot: string | undefined;
  #imagesDropped = false;

  constructor(systemPrompt: string, firstUserMessage: string)
  {
    this.#messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: firstUserMessage },
    ];
  }

  addAssistant(message: PageAgentAssistantMessage): void
  {
    const toolCalls = message.tool_calls ?? [];
    this.#messages.push({
      role: 'assistant',
      content: message.content ?? null,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
    });
  }

  addToolResult(toolCallId: string, content: string): void
  {
    this.#messages.push({ role: 'tool', tool_call_id: toolCallId, content });
  }

  addUserText(text: string): void
  {
    this.#messages.push({ role: 'user', content: text });
  }

  queueScreenshot(dataUrl: string): void
  {
    this.#pendingScreenshot = dataUrl;
  }

  // Chat Completions tool messages carry text only, and every tool message of a response has to
  // follow it directly, so the image goes into one user message after all of them.
  flushScreenshot(): void
  {
    if (this.#pendingScreenshot === undefined)
    {
      return;
    }
    this.#messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Screenshot of the visible part of the page, from your screenshot call.' },
        { type: 'image_url', image_url: { url: this.#pendingScreenshot } },
      ],
    });
    this.#pendingScreenshot = undefined;
  }

  dropImages(): void
  {
    this.#imagesDropped = true;
  }

  // Only the latest screenshot is sent, to bound tokens; older ones become a text placeholder.
  requestMessages(): PageAgentMessage[]
  {
    let latestImage = -1;
    if (!this.#imagesDropped)
    {
      for (let index = this.#messages.length - 1; index >= 0; index--)
      {
        if (hasImage(this.#messages[index]))
        {
          latestImage = index;
          break;
        }
      }
    }
    return this.#messages.map((message, index) =>
      index === latestImage || !hasImage(message) ? message : withoutImages(message));
  }
}

/** The plugins passed to a run. Core tools win: a plugin gets only the calls the core switch leaves. */
class RunPlugins
{
  readonly #plugins: readonly PageAgentToolPlugin[];

  constructor(plugins: readonly PageAgentToolPlugin[])
  {
    this.#plugins = plugins;
  }

  tools(): PageAgentToolDefinition[]
  {
    return this.#plugins.flatMap(plugin => plugin.tools());
  }

  promptSections(): string[]
  {
    return this.#plugins.map(plugin => plugin.promptSection());
  }

  declaring(toolName: string): PageAgentToolPlugin | undefined
  {
    return this.#plugins.find(plugin => plugin.tools().some(tool => tool.function.name === toolName));
  }
}

interface ToolOutcome
{
  content: string;
  step: PageAgentStep;
  /** Set by a valid report or show_popup: the run ends with it. */
  finished?: PageAgentRunResult;
}

export class PageAgentRun
{
  readonly tabId: number;
  readonly #userRequest: string;
  readonly #client: PageAgentModelClient;
  readonly #adapter: PageAgentPageAdapter;
  readonly #listener: PageAgentRunListener;
  readonly #screenshots: boolean;
  readonly #scripts: boolean;
  readonly #plugins: RunPlugins;
  readonly #history: ChatHistory;
  readonly #conversation: RunConversation;
  readonly #tools: PageAgentToolDefinition[];
  readonly #createId: () => string;
  readonly #debug: boolean;
  readonly #controller = new AbortController();
  readonly #conditions = new RunConditions();
  readonly #measurement: ChangeMeasurement;
  #currentCss: string;
  #currentCssByUser: boolean;
  #currentScript: string;
  #insertedText: string;
  /** The user's answer to the run's first script; kept for every later one on the same site. */
  #scriptApproval: RunScriptApproval | undefined;
  #imagesRejected = false;
  #started = false;
  #round = 0;

  constructor(options: PageAgentRunOptions)
  {
    this.tabId = options.tabId;
    this.#userRequest = options.request;
    this.#client = options.client;
    this.#adapter = options.adapter;
    this.#listener = options.listener;
    this.#screenshots = options.screenshots;
    this.#scripts = options.scripts;
    this.#measurement = new ChangeMeasurement(options.scripts);
    this.#plugins = new RunPlugins(options.plugins ?? []);
    this.#history = new ChatHistory(options.history ?? []);
    this.#currentCss = options.currentCss ?? '';
    this.#currentCssByUser = options.currentCssByUser ?? false;
    this.#currentScript = options.currentScript ?? '';
    this.#conversation = new RunConversation(
      pageAgentSystemPrompt(options.screenshots, options.scripts, this.#plugins.promptSections()),
      this.#history.firstUserMessage(
        options.request,
        this.#currentCss,
        this.#currentScript,
        options.scripts,
        this.#currentCssByUser,
      ),
    );
    this.#tools = [...pageAgentToolDefinitions(options.screenshots, options.scripts), ...this.#plugins.tools()];
    this.#insertedText = options.insertedText ?? '';
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#debug = options.debug ?? false;
  }

  /** Ends the run as `stopped`: the model request is abandoned and no further tool runs. */
  stop(): void
  {
    this.#controller.abort();
  }

  /** Runs the loop once and calls `onFinished` with the result it also returns. */
  async run(): Promise<PageAgentRunResult>
  {
    if (this.#started)
    {
      throw new Error('A PageAgentRun runs only once');
    }
    this.#started = true;

    let result: PageAgentRunResult;
    try
    {
      result = await this.#loop();
    }
    catch (error)
    {
      // Whatever the client or adapter threw after Stop (AbortError, a network error), the run was stopped.
      result = this.#controller.signal.aborted
        ? this.#result('stopped', this.#conditions.allUnmet(NO_REPORT), 'Stopped.')
        : this.#result('error', this.#conditions.allUnmet(NO_REPORT), '', errorMessage(error));
    }
    this.#log('finished', result);
    this.#listener.onFinished(result);
    return result;
  }

  async #loop(): Promise<PageAgentRunResult>
  {
    for (let round = 0; round < PAGE_AGENT_MAX_ROUNDS; round++)
    {
      this.#round = round;
      this.#throwIfStopped();
      const message = await this.#complete();
      this.#throwIfStopped();
      this.#conversation.addAssistant(message);

      const toolCalls = message.tool_calls ?? [];
      this.#log(`round ${round + 1}`, toolCalls.map(call => call.function?.name));
      if (toolCalls.length === 0)
      {
        return this.#textReply(message.content?.trim() ?? '');
      }

      for (const call of toolCalls)
      {
        this.#throwIfStopped();
        const outcome = await this.#runTool(call);
        this.#listener.onStep(outcome.step);
        if (outcome.finished)
        {
          return outcome.finished;
        }
        this.#conversation.addToolResult(call.id, outcome.content);
      }
      this.#conversation.flushScreenshot();
    }

    return await this.#finalReport();
  }

  // At the round limit the model has often measured everything and only lacks the response for the
  // report, so one more request that can only call report gets its numbers instead of "no report".
  async #finalReport(): Promise<PageAgentRunResult>
  {
    if (!this.#conditions.isSet)
    {
      return this.#result('not-met', [], `No answer after ${PAGE_AGENT_MAX_ROUNDS} steps.`);
    }
    const limitReached = this.#result(
      'not-met',
      this.#conditions.allUnmet(NO_REPORT),
      `No report after ${PAGE_AGENT_MAX_ROUNDS} steps.`,
    );

    this.#round = PAGE_AGENT_MAX_ROUNDS;
    const report = PAGE_AGENT_TOOL_NAMES.report;
    const measurement = this.#measurement;
    this.#conversation.addUserText(
      `You have used all ${PAGE_AGENT_MAX_ROUNDS} responses for this request. Call ${report} now: give each ` +
      `condition the last value you measured, and mark it met only if an ${measurement.measureTools} after ` +
      `your last ${measurement.changeTools} showed it.`,
    );
    let message: PageAgentAssistantMessage;
    try
    {
      message = await this.#complete(report);
    }
    catch (error)
    {
      // A provider that can't force a tool must not turn a finished run into an error.
      if (this.#controller.signal.aborted)
      {
        throw error;
      }
      this.#log('final report request failed', error);
      return limitReached;
    }
    this.#throwIfStopped();

    const call = message.tool_calls?.find(entry => entry.function?.name === report);
    if (!call)
    {
      return limitReached;
    }
    if (!measurement.seenBefore(this.#round))
    {
      // The model's numbers predate its last change, so none of them counts.
      this.#listener.onStep(step(report, '', `refused: no ${measurement.measureTools} after the last ${measurement.changeTools}`));
      return this.#result(
        'not-met',
        this.#conditions.allUnmet(`not measured after the last ${measurement.lastChange}`),
        `No measurement after the last ${measurement.lastChange} within ${PAGE_AGENT_MAX_ROUNDS} steps.`,
      );
    }
    const outcome = await this.#runTool(call);
    this.#listener.onStep(outcome.step);
    return outcome.finished ?? limitReached;
  }

  // An answer or a clarifying question. Once conditions are set the request is a style change, which
  // ends only with a report: a text reply then is not success.
  #textReply(text: string): PageAgentRunResult
  {
    if (this.#conditions.isSet)
    {
      return this.#result('not-met', this.#conditions.allUnmet(NO_REPORT), text || 'The model answered without a report.');
    }
    return text ? this.#result('answered', [], text) : this.#result('not-met', [], NO_ANSWER);
  }

  // A 400 on a request with an image usually means the model doesn't take images: the request is
  // sent again once without them, and screenshots stay off for the rest of the run.
  async #complete(toolChoice?: string): Promise<PageAgentAssistantMessage>
  {
    const request = this.#request(toolChoice);
    try
    {
      return await this.#send(request);
    }
    catch (error)
    {
      const imageRejected = error instanceof PageAgentModelError && error.status === 400;
      if (this.#controller.signal.aborted || !imageRejected || !request.messages.some(hasImage))
      {
        throw error;
      }
      this.#log('images rejected, retrying without them');
      this.#imagesRejected = true;
      this.#conversation.dropImages();
      return await this.#send(this.#request(toolChoice));
    }
  }

  #request(toolChoice?: string): PageAgentModelRequest
  {
    const messages = this.#conversation.requestMessages();
    if (toolChoice === undefined)
    {
      return { messages, tools: this.#tools };
    }
    return { messages, tools: this.#tools.filter(tool => tool.function.name === toolChoice), toolChoice };
  }

  async #send(request: PageAgentModelRequest): Promise<PageAgentAssistantMessage>
  {
    return await this.#untilStopped(this.#client.complete(request, this.#controller.signal));
  }

  // Raced against the run's signal, so Stop ends the run at once even when the work ignores it: a
  // client that doesn't watch the signal, or a plugin waiting on a page download that stalls. Core
  // page calls aren't raced: their results (inserted CSS) must still reach the listener after Stop.
  async #untilStopped<T>(work: Promise<T>): Promise<T>
  {
    const signal = this.#controller.signal;
    const stopped = new Promise<never>((_resolve, reject) =>
    {
      if (signal.aborted)
      {
        reject(new RunStoppedError());
        return;
      }
      signal.addEventListener('abort', () => reject(new RunStoppedError()), { once: true });
    });
    return await Promise.race([work, stopped]);
  }

  async #runTool(call: PageAgentToolCall): Promise<ToolOutcome>
  {
    const name = call.function?.name ?? '';
    const rawArguments = call.function?.arguments ?? '';
    const parsed = parseJsonArguments(rawArguments);
    if (!parsed.ok)
    {
      return toolError(name, shortText(rawArguments), parsed.error);
    }

    switch (name)
    {
      case PAGE_AGENT_TOOL_NAMES.outline:
        return this.#outline();
      case PAGE_AGENT_TOOL_NAMES.readPageText:
        return await this.#readPageText();
      case PAGE_AGENT_TOOL_NAMES.setConditions:
        return this.#setConditions(parsed.value);
      case PAGE_AGENT_TOOL_NAMES.applyCss:
        return await this.#applyCss(parsed.value);
      case PAGE_AGENT_TOOL_NAMES.inspect:
        return await this.#inspect(parsed.value);
      // Refused rather than unknown: a model that saw the tools in an earlier request learns why.
      case PAGE_AGENT_TOOL_NAMES.applyScript:
        return this.#scripts ? await this.#applyScript(parsed.value) : toolError(name, '', SCRIPTS_OFF);
      case PAGE_AGENT_TOOL_NAMES.runCheck:
        return this.#scripts ? await this.#runCheck(parsed.value) : toolError(name, '', SCRIPTS_OFF);
      case PAGE_AGENT_TOOL_NAMES.screenshot:
        if (this.#screenshots)
        {
          return await this.#screenshot();
        }
        break;
      case PAGE_AGENT_TOOL_NAMES.showPopup:
        return await this.#showPopup(parsed.value);
      case PAGE_AGENT_TOOL_NAMES.report:
        return this.#report(parsed.value);
    }
    const plugin = this.#plugins.declaring(name);
    if (plugin)
    {
      return await this.#callPlugin(plugin, name, parsed.value, shortText(rawArguments));
    }
    return toolError(name, shortText(rawArguments), `unknown tool "${name}"`);
  }

  // Unlike a core tool's page call, a plugin failure doesn't end the run: the model hears why and
  // can still answer from what it has.
  async #callPlugin(plugin: PageAgentToolPlugin, name: string, args: unknown, argsSummary: string): Promise<ToolOutcome>
  {
    let result: PageAgentPluginResult;
    try
    {
      result = await this.#untilStopped(plugin.call(name, args, this.tabId));
    }
    catch (error)
    {
      if (this.#controller.signal.aborted)
      {
        throw error;
      }
      this.#log(`${name} failed`, error);
      return toolError(name, argsSummary, errorMessage(error));
    }
    if (!result.ok)
    {
      return toolError(name, argsSummary, result.error);
    }
    return { content: result.content, step: step(name, argsSummary, shortText(result.summary)) };
  }

  async #outline(): Promise<ToolOutcome>
  {
    const outline = await this.#adapter.outline(this.tabId);
    return { content: outline, step: step(PAGE_AGENT_TOOL_NAMES.outline, '', shortText(outline)) };
  }

  // The step keeps a preview only: the persisted step log must not hold the whole page text.
  async #readPageText(): Promise<ToolOutcome>
  {
    const text = await this.#adapter.readText(this.tabId);
    return { content: text, step: step(PAGE_AGENT_TOOL_NAMES.readPageText, '', shortText(text)) };
  }

  // Terminal, like report: the popup's markdown is the turn's answer, so the model never writes it twice.
  async #showPopup(args: unknown): Promise<ToolOutcome>
  {
    const name = PAGE_AGENT_TOOL_NAMES.showPopup;
    if (this.#conditions.isSet)
    {
      return toolError(
        name,
        '',
        `refused: ${name} is for answers to questions; this request changes the page, so end it with ${PAGE_AGENT_TOOL_NAMES.report}`,
      );
    }
    const parsed = parseShowPopupArgs(args);
    if (!parsed.ok)
    {
      return toolError(name, '', parsed.error);
    }

    const { title, markdown } = parsed.value;
    try
    {
      await this.#adapter.showPopup(this.tabId, title, { question: this.#userRequest, markdown });
    }
    catch (error)
    {
      if (this.#controller.signal.aborted)
      {
        throw error;
      }
      // The answer is already written: a page that won't show it (the tab moved to a page that can't
      // be scripted) must not cost it, so the turn still ends answered and the chat holds it.
      const failed = `failed: ${errorMessage(error)}`;
      return { content: failed, step: step(name, shortText(title), failed), finished: this.#result('answered', [], markdown) };
    }
    return {
      content: 'shown',
      step: step(name, shortText(title), 'shown'),
      finished: { ...this.#result('answered', [], markdown), openedPopup: true },
    };
  }

  #setConditions(args: unknown): ToolOutcome
  {
    const name = PAGE_AGENT_TOOL_NAMES.setConditions;
    const parsed = parseSetConditionsArgs(args);
    if (!parsed.ok)
    {
      return toolError(name, '', parsed.error);
    }

    const { conditions } = parsed.value;
    const summary = shortText(conditions.map(condition => `${condition.id}: ${condition.text}`).join('; '));
    const replaced = parsed.value.replaced.map(entry => ({
      id: entry.id,
      text: this.#history.conditionText(entry.id),
      reason: entry.reason,
    }));
    if (!this.#conditions.set(conditions, replaced))
    {
      return toolError(
        name,
        summary,
        `refused: this request's conditions are already set and can't change; work on them and report any you can't meet as unmet`,
      );
    }
    this.#listener.onConditions(conditions, replaced);

    return { content: 'ok', step: step(name, summary, 'ok') };
  }

  async #applyCss(args: unknown): Promise<ToolOutcome>
  {
    const name = PAGE_AGENT_TOOL_NAMES.applyCss;
    // Conditions first, so every change is checked against what the user asked for.
    if (!this.#conditions.isSet)
    {
      return toolError(name, '', `refused: call ${PAGE_AGENT_TOOL_NAMES.setConditions} first`);
    }
    // Whatever its outcome, the model learns it only from the next request.
    this.#measurement.changed();
    const parsed = parseApplyCssArgs(args);
    if (!parsed.ok)
    {
      return toolError(name, '', parsed.error);
    }

    const css = parsed.value;
    const argsSummary = `${css.length} characters`;
    const check = PageAgentCssSanitizer.check(css);
    if (!check.ok)
    {
      return { content: `rejected: ${check.reason}`, step: { ...step(name, argsSummary, `rejected: ${check.reason}`), css } };
    }

    const url = await this.#adapter.pageUrl(this.tabId);
    await this.#replaceApplied(url, { css });

    return { content: 'ok', step: { ...step(name, argsSummary, 'ok'), css } };
  }

  // CSS and script are one applied set under one marker id: a change to either part mints a new id
  // and replaces the marker sheet (marker-only without CSS), so the marker tells whether the page
  // still has the set. The part the change leaves out is kept, the user's CSS with its flag: an
  // apply_script must not make the user's CSS look like the agent's, which save would sanitize.
  async #replaceApplied(url: string, change: { css?: string; script?: string }): Promise<void>
  {
    const css = change.css ?? this.#currentCss;
    const cssByUser = change.css !== undefined ? false : this.#currentCssByUser;
    const script = change.script ?? this.#currentScript;
    if (this.#insertedText)
    {
      await this.#adapter.removeCss(this.tabId, this.#insertedText);
    }
    const appliedId = this.#createId();
    const insertedText = withMarker(css, appliedId);
    await this.#adapter.insertCss(this.tabId, insertedText);
    this.#insertedText = insertedText;
    this.#currentCss = css;
    this.#currentCssByUser = cssByUser;
    this.#currentScript = script;
    // Recorded before any stop check: the stylesheet is on the page now, and Undo needs its text.
    this.#listener.onApplied({ css, script, insertedText, appliedId, url, cssByUser });
  }

  async #applyScript(args: unknown): Promise<ToolOutcome>
  {
    const name = PAGE_AGENT_TOOL_NAMES.applyScript;
    if (!this.#conditions.isSet)
    {
      return toolError(name, '', `refused: call ${PAGE_AGENT_TOOL_NAMES.setConditions} first`);
    }
    // Whatever its outcome, the model learns it only from the next request.
    this.#measurement.changed();
    const parsed = parseScriptArgs(args);
    if (!parsed.ok)
    {
      return toolError(name, '', parsed.error);
    }

    // Blank code removes the script, so the chat holds no blank script with Undo and Show code for it.
    const code = parsed.value.trim() ? parsed.value : '';
    const argsSummary = `${code.length} characters`;
    const check = PageAgentScriptCheck.check(code);
    if (!check.ok)
    {
      return scriptOutcome(name, argsSummary, `rejected: ${check.reason}`, code);
    }
    // Removing runs none of the agent's code, so it isn't asked: an empty approval card would use up the
    // run's only answer, and a Deny there would keep the old script on the page.
    const refusal = code ? await this.#scriptRefusal('apply', code) : null;
    if (refusal !== null)
    {
      return scriptOutcome(name, argsSummary, refusal, code);
    }

    const url = await this.#adapter.pageUrl(this.tabId);
    const result = await this.#adapter.runUserScript(this.tabId, code ? { kind: 'apply', code } : { kind: 'undo' });
    // Code that doesn't compile changed nothing: the script applied before keeps running. Compiled
    // code that threw or timed out keeps what it registered, so the set records it for Undo.
    if (result.compiled)
    {
      await this.#replaceApplied(url, { script: code });
    }
    return scriptOutcome(name, argsSummary, JSON.stringify(result), code);
  }

  async #runCheck(args: unknown): Promise<ToolOutcome>
  {
    const name = PAGE_AGENT_TOOL_NAMES.runCheck;
    const parsed = parseScriptArgs(args);
    if (!parsed.ok)
    {
      return toolError(name, '', parsed.error);
    }

    const code = parsed.value;
    const argsSummary = `${code.length} characters`;
    // Not put to the user: a blank check measures nothing, and its card would use up the run's only answer.
    if (!code.trim())
    {
      return toolError(name, argsSummary, 'refused: the code is empty; send a script that returns what it measured');
    }
    const refusal = await this.#scriptRefusal('check', code);
    if (refusal !== null)
    {
      return scriptOutcome(name, argsSummary, refusal, code);
    }
    const result = await this.#adapter.runUserScript(this.tabId, { kind: 'check', code });
    if (result.compiled)
    {
      this.#measurement.measured(this.#round);
    }
    return scriptOutcome(name, argsSummary, JSON.stringify(result), code);
  }

  // Null when the script may run, else the refusal the model gets. Asked once per run: the first
  // script's answer covers the rest of the request on that site, so a Deny is never asked again.
  // Raced against Stop, as the user may never answer.
  async #scriptRefusal(kind: PageAgentScriptRequest['kind'], code: string): Promise<string | null>
  {
    const origin = httpOriginOf(await this.#adapter.pageUrl(this.tabId));
    if (origin === null)
    {
      return SCRIPTS_NO_SITE;
    }
    this.#scriptApproval ??= new RunScriptApproval(origin, this.#listener.onScriptApproval({ kind, code, origin }));
    if (!(await this.#untilStopped(this.#scriptApproval.answer)))
    {
      return SCRIPTS_DECLINED;
    }
    // Read again after the answer: the tab may have moved while the card waited for it.
    const current = httpOriginOf(await this.#adapter.pageUrl(this.tabId));
    return this.#scriptApproval.covers(current) ? null : this.#scriptApproval.otherSiteRefusal(current);
  }

  async #inspect(args: unknown): Promise<ToolOutcome>
  {
    const parsed = parseInspectArgs(args);
    if (!parsed.ok)
    {
      return toolError(PAGE_AGENT_TOOL_NAMES.inspect, '', parsed.error);
    }
    const result = await this.#adapter.inspect(this.tabId, parsed.value);
    this.#measurement.measured(this.#round);
    return {
      content: result,
      step: step(PAGE_AGENT_TOOL_NAMES.inspect, shortText(parsed.value.join(', ')), shortText(result)),
    };
  }

  async #screenshot(): Promise<ToolOutcome>
  {
    const name = PAGE_AGENT_TOOL_NAMES.screenshot;
    if (this.#imagesRejected)
    {
      return { content: SCREENSHOTS_REJECTED, step: step(name, '', SCREENSHOTS_REJECTED) };
    }
    const capture = await this.#adapter.capture(this.tabId);
    if ('unavailable' in capture)
    {
      return { content: capture.unavailable, step: step(name, '', capture.unavailable) };
    }
    this.#conversation.queueScreenshot(capture.dataUrl);
    return { content: 'attached', step: { ...step(name, '', 'attached'), screenshotDataUrl: capture.dataUrl } };
  }

  #report(args: unknown): ToolOutcome
  {
    const name = PAGE_AGENT_TOOL_NAMES.report;
    const parsed = parseReportArgs(args);
    if (!parsed.ok)
    {
      return toolError(name, '', parsed.error);
    }

    const { results, summary } = parsed.value;
    const reportStep = step(name, shortText(summary), 'done');
    // Without conditions nothing can have changed (apply_css and apply_script are refused), so the summary is an answer.
    if (!this.#conditions.isSet)
    {
      const finished = summary ? this.#result('answered', [], summary) : this.#result('not-met', [], NO_ANSWER);
      return { content: 'done', step: reportStep, finished };
    }
    const measurement = this.#measurement;
    if (!measurement.seenBefore(this.#round))
    {
      return toolError(
        name,
        shortText(summary),
        `refused: ${measurement.measureTools} after your last ${measurement.changeTools} and call ${name} in a later response, once you have seen the numbers`,
      );
    }

    const conditions = this.#conditions.fromReport(results);
    const status = conditions.every(condition => condition.met) ? 'met' : 'not-met';
    return { content: 'done', step: reportStep, finished: this.#result(status, conditions, summary) };
  }

  #result(
    status: PageAgentRunStatus,
    conditions: PageAgentConditionOutcome[],
    summary: string,
    error?: string,
  ): PageAgentRunResult
  {
    return {
      status,
      conditions,
      replaced: this.#conditions.replaced,
      summary,
      ...(error !== undefined && { error }),
      ...(this.#imagesRejected && { screenshotsNote: SCREENSHOTS_REJECTED_NOTE }),
    };
  }

  #throwIfStopped(): void
  {
    if (this.#controller.signal.aborted)
    {
      throw new RunStoppedError();
    }
  }

  #log(...values: unknown[]): void
  {
    if (this.#debug)
    {
      console.log('[page-agent]', `tab ${this.tabId}`, ...values);
    }
  }
}

function describeTurn(turn: PageAgentHistoryTurn, number: number): string
{
  const lines = [`${number}. Request: ${turn.request}`, `   Outcome: ${turn.status}`];
  for (const condition of turn.conditions)
  {
    const measured = condition.measured ? ` (${condition.measured})` : '';
    lines.push(`   - [${condition.id}] ${condition.text}: ${condition.met ? 'met' : 'unmet'}${measured}`);
  }
  for (const entry of turn.replaced)
  {
    lines.push(`   - [${entry.id}] replaced: ${entry.reason}`);
  }
  if (turn.summary)
  {
    lines.push(`   ${turn.status === 'answered' ? 'Answer' : 'Summary'}: ${turn.summary}`);
  }
  return lines.join('\n');
}

function hasImage(message: PageAgentMessage): boolean
{
  return message.role === 'user' && Array.isArray(message.content) &&
    message.content.some(part => part.type === 'image_url');
}

// Text only, so a provider that rejected the image gets a plain message.
function withoutImages(message: PageAgentMessage): PageAgentMessage
{
  if (message.role !== 'user' || !Array.isArray(message.content))
  {
    return message;
  }
  const text = message.content.map(part => part.type === 'text' ? part.text : SCREENSHOT_OMITTED).join('\n');
  return { role: 'user', content: text };
}

function parseJsonArguments(text: string): { ok: true; value: unknown } | { ok: false; error: string }
{
  // Some providers send an empty string for a tool without arguments.
  if (!text.trim())
  {
    return { ok: true, value: {} };
  }
  try
  {
    return { ok: true, value: JSON.parse(text) };
  }
  catch
  {
    return { ok: false, error: 'invalid arguments: not valid JSON' };
  }
}

function toolError(name: string, args: string, error: string): ToolOutcome
{
  return { content: error, step: step(name, args, error) };
}

function step(tool: string, args: string, result: string): PageAgentStep
{
  return { tool, args, result };
}

// The step log is persisted with the chat, so a long script is cut there; the applied one is kept
// whole in the chat's applied set.
function scriptOutcome(tool: string, args: string, content: string, code: string): ToolOutcome
{
  const script = code.length > STEP_SCRIPT_LIMIT
    ? `${code.slice(0, STEP_SCRIPT_LIMIT)}\n… (cut at ${STEP_SCRIPT_LIMIT} characters)`
    : code;
  return { content, step: { ...step(tool, args, shortText(content)), ...(script !== '' && { script }) } };
}

function shortText(text: string): string
{
  return text.length > STEP_TEXT_LIMIT ? `${text.slice(0, STEP_TEXT_LIMIT)}...` : text;
}

function errorMessage(error: unknown): string
{
  if (error instanceof Error && error.message)
  {
    return error.message;
  }
  return typeof error === 'string' && error ? error : 'Unknown error';
}
