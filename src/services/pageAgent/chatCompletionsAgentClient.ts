// The page agent's model client: one Chat Completions request per round of the run. It always uses
// the Chat Completions endpoint, whatever the AI protocol setting says: tool calling there
// (`tools`, `tool_calls`, `role: "tool"`) works across the most OpenAI-compatible providers.

import { aiHttpStatusMessage, normalizeAiEndpoint } from '../../utils/aiConfig.ts';
import type { AiRenameSettings } from '../../utils/aiConfig.ts';
import { PageAgentModelError } from './pageAgentRun.ts';
import type {
  PageAgentAssistantMessage,
  PageAgentModelClient,
  PageAgentModelRequest,
  PageAgentToolCall,
} from './pageAgentRun.ts';

export type ChatCompletionsAgentSettings = Pick<AiRenameSettings, 'baseUrl' | 'apiKey' | 'model' | 'reasoningEffort'>;

// Room for a whole stylesheet plus the reasoning tokens that count against the same limit.
const MAX_COMPLETION_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 120_000;
const API_DETAIL_LIMIT = 300;

/** The run's signal plus the request timeout, remembering which of them ended the request. */
class RequestSignal
{
  readonly #controller = new AbortController();
  readonly #outer: AbortSignal;
  readonly #timer: ReturnType<typeof setTimeout>;
  readonly #onOuterAbort = (): void => this.#controller.abort();
  #timedOut = false;

  constructor(outer: AbortSignal, timeoutMs: number)
  {
    this.#outer = outer;
    if (outer.aborted)
    {
      this.#controller.abort();
    }
    else
    {
      outer.addEventListener('abort', this.#onOuterAbort, { once: true });
    }
    this.#timer = setTimeout(() =>
    {
      this.#timedOut = true;
      this.#controller.abort();
    }, timeoutMs);
  }

  get signal(): AbortSignal
  {
    return this.#controller.signal;
  }

  get timedOut(): boolean
  {
    return this.#timedOut && !this.#outer.aborted;
  }

  dispose(): void
  {
    clearTimeout(this.#timer);
    this.#outer.removeEventListener('abort', this.#onOuterAbort);
  }
}

export class ChatCompletionsAgentClient implements PageAgentModelClient
{
  readonly #settings: ChatCompletionsAgentSettings;

  constructor(settings: ChatCompletionsAgentSettings)
  {
    this.#settings = settings;
  }

  async complete(request: PageAgentModelRequest, signal: AbortSignal): Promise<PageAgentAssistantMessage>
  {
    const apiKey = this.#settings.apiKey.trim();
    const model = this.#settings.model.trim();
    if (!this.#settings.baseUrl.trim()) throw new PageAgentModelError('Base URL is required');
    if (!apiKey) throw new PageAgentModelError('API Key is required');
    if (!model) throw new PageAgentModelError('Model is required');

    const endpoint = normalizeAiEndpoint(this.#settings.baseUrl, 'chat-completions');
    const body = {
      model,
      messages: request.messages,
      tools: request.tools,
      tool_choice: 'auto',
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      ...(this.#settings.reasoningEffort !== 'off' && { reasoning_effort: this.#settings.reasoningEffort }),
    };

    const requestSignal = new RequestSignal(signal, REQUEST_TIMEOUT_MS);
    try
    {
      let response: Response;
      try
      {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          credentials: 'omit',
          signal: requestSignal.signal,
        });
      }
      catch
      {
        throw this.#connectionError(requestSignal);
      }

      // The body is read under the same timeout: a provider can send headers and then stall.
      let text: string;
      try
      {
        text = await response.text();
      }
      catch
      {
        throw this.#connectionError(requestSignal);
      }

      if (!response.ok)
      {
        throw new PageAgentModelError(statusMessage(response.status, text, apiKey), response.status);
      }

      let payload: unknown;
      try
      {
        payload = JSON.parse(text);
      }
      catch
      {
        throw new PageAgentModelError('The API returned invalid JSON');
      }
      return parseAssistantMessage(payload);
    }
    finally
    {
      requestSignal.dispose();
    }
  }

  #connectionError(requestSignal: RequestSignal): PageAgentModelError
  {
    if (requestSignal.timedOut)
    {
      return new PageAgentModelError(`The API did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds`);
    }
    if (requestSignal.signal.aborted)
    {
      return new PageAgentModelError('The request was stopped');
    }
    return new PageAgentModelError('Unable to connect to the API');
  }
}

// A 400 carries the provider's reason (no tool calling, no images, a bad parameter), which the
// user needs to fix the setup. 401 and 403 keep the plain wording: their text can quote the key.
function statusMessage(status: number, responseText: string, apiKey: string): string
{
  if (status === 405)
  {
    return 'This endpoint does not support Chat Completions, which the page agent needs';
  }
  const message = aiHttpStatusMessage(status);
  if (status === 401 || status === 403)
  {
    return message;
  }
  const detail = apiErrorDetail(responseText, apiKey);
  return detail ? `${message}: ${detail}` : message;
}

function apiErrorDetail(responseText: string, apiKey: string): string
{
  let payload: unknown;
  try
  {
    payload = JSON.parse(responseText);
  }
  catch
  {
    // An HTML error page says nothing useful in a one-line message.
    return '';
  }

  const data = asRecord(payload);
  const error = data?.error;
  const raw = typeof error === 'string'
    ? error
    : asString(asRecord(error)?.message) ?? asString(data?.message) ?? '';
  const detail = raw.replace(/\s+/g, ' ').trim().split(apiKey).join('***');
  return detail.length > API_DETAIL_LIMIT ? `${detail.slice(0, API_DETAIL_LIMIT)}...` : detail;
}

function parseAssistantMessage(payload: unknown): PageAgentAssistantMessage
{
  const choices = asRecord(payload)?.choices;
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
  const message = asRecord(choice?.message);
  if (!choice || !message)
  {
    throw new PageAgentModelError('The API response did not contain a message');
  }

  const toolCalls = parseToolCalls(message.tool_calls);
  // A refusal comes in its own field with content null; showing it beats "answered without a report".
  const content = messageText(message.content) ?? asString(message.refusal) ?? null;
  if (toolCalls.length === 0 && !content?.trim() && choice.finish_reason === 'length')
  {
    throw new PageAgentModelError('The model used up its output limit before answering; try a lower reasoning effort');
  }

  return {
    role: 'assistant',
    content,
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };
}

function parseToolCalls(value: unknown): PageAgentToolCall[]
{
  if (!Array.isArray(value))
  {
    return [];
  }

  const calls: PageAgentToolCall[] = [];
  value.forEach((entry, index) =>
  {
    const call = asRecord(entry);
    const fn = asRecord(call?.function);
    if (!call || !fn)
    {
      return;
    }
    // Some providers send the arguments as an object or omit the id; the run needs JSON text, and
    // an id it makes up here goes back with the assistant message, so the tool results still match.
    const args = typeof fn.arguments === 'string'
      ? fn.arguments
      : fn.arguments === undefined || fn.arguments === null ? '' : JSON.stringify(fn.arguments);
    calls.push({
      id: asString(call.id) || `call_${index}`,
      type: 'function',
      function: { name: asString(fn.name) ?? '', arguments: args },
    });
  });
  return calls;
}

function messageText(content: unknown): string | undefined
{
  if (typeof content === 'string')
  {
    return content;
  }
  if (!Array.isArray(content))
  {
    return undefined;
  }
  const texts = content
    .map(part => asRecord(part))
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part?.text as string);
  return texts.length > 0 ? texts.join('\n') : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined
{
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined
{
  return typeof value === 'string' ? value : undefined;
}
