// The page agent's model client: one request per round of the run, through the API protocol of the
// AI settings, the same way AI Rename picks it. Auto with a Base URL that names no endpoint tries
// Responses first and falls back to Chat Completions when the endpoint lacks Responses.

import {
  aiEndpointLacksProtocol,
  aiHttpStatusMessage,
  resolveAiEndpointCandidates,
} from '../../utils/aiConfig.ts';
import type { AiEndpointCandidate, AiRenameSettings } from '../../utils/aiConfig.ts';
import { asRecord, asString, pageAgentApiFormat } from './pageAgentApiFormats.ts';
import { PageAgentModelError } from './pageAgentRun.ts';
import type {
  PageAgentAssistantMessage,
  PageAgentModelClient,
  PageAgentModelRequest,
} from './pageAgentRun.ts';

export type PageAgentClientSettings = Pick<
  AiRenameSettings,
  'baseUrl' | 'apiKey' | 'model' | 'protocol' | 'reasoningEffort'
>;

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

/** An error answer of the API. Still a PageAgentModelError with the status, for the image retry. */
class PageAgentHttpError extends PageAgentModelError
{
  readonly lacksProtocol: boolean;

  constructor(message: string, status: number, lacksProtocol: boolean)
  {
    super(message, status);
    this.lacksProtocol = lacksProtocol;
  }
}

export class PageAgentApiClient implements PageAgentModelClient
{
  readonly #settings: PageAgentClientSettings;
  // One client serves one run: once a protocol has answered, the rest of the run stays on it.
  #candidates: AiEndpointCandidate[] | null = null;

  constructor(settings: PageAgentClientSettings)
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

    const candidates = this.#candidates ??
      resolveAiEndpointCandidates(this.#settings.baseUrl, this.#settings.protocol);
    for (const [index, candidate] of candidates.entries())
    {
      const format = pageAgentApiFormat(candidate.protocol);
      const body = format.body(request, { model, reasoningEffort: this.#settings.reasoningEffort });
      let payload: unknown;
      try
      {
        payload = await this.#post(candidate.url, body, apiKey, signal);
      }
      catch (error)
      {
        const tryNext = index < candidates.length - 1 &&
          error instanceof PageAgentHttpError && error.lacksProtocol;
        if (!tryNext)
        {
          throw error;
        }
        continue;
      }
      this.#candidates = [candidate];
      return format.parse(payload);
    }
    // Not reached: the last candidate either answers or throws.
    throw new PageAgentModelError('No API endpoint answered');
  }

  async #post(url: string, body: Record<string, unknown>, apiKey: string, signal: AbortSignal): Promise<unknown>
  {
    const requestSignal = new RequestSignal(signal, REQUEST_TIMEOUT_MS);
    try
    {
      let response: Response;
      try
      {
        response = await fetch(url, {
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
        throw connectionError(requestSignal);
      }

      // The body is read under the same timeout: a provider can send headers and then stall.
      let text: string;
      try
      {
        text = await response.text();
      }
      catch
      {
        throw connectionError(requestSignal);
      }

      if (!response.ok)
      {
        throw new PageAgentHttpError(
          statusMessage(response.status, text, apiKey),
          response.status,
          aiEndpointLacksProtocol(response.status, text),
        );
      }

      try
      {
        return JSON.parse(text);
      }
      catch
      {
        throw new PageAgentModelError('The API returned invalid JSON');
      }
    }
    finally
    {
      requestSignal.dispose();
    }
  }
}

function connectionError(requestSignal: RequestSignal): PageAgentModelError
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

// A 400 carries the provider's reason (no tool calling, no images, a bad parameter), which the
// user needs to fix the setup. 401 and 403 keep the plain wording: their text can quote the key.
function statusMessage(status: number, responseText: string, apiKey: string): string
{
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
