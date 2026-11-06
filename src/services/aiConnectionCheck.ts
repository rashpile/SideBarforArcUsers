import {
  AiEndpointCandidate,
  AiSettings,
  ResolvedAiApiProtocol,
  aiEndpointLacksProtocol,
  aiHttpStatusMessage,
  buildAiRequestBody,
  extractAiResponseText,
  resolveAiEndpointCandidates,
} from '../utils/aiConfig';

const CHECK_PROMPT = 'Reply with exactly OK and nothing else.';
const REQUEST_TIMEOUT_MS = 20_000;

export interface AiConnectionCheckResult
{
  protocol: ResolvedAiApiProtocol;
  latencyMs: number;
}

class AiHttpError extends Error
{
  constructor(
    message: string,
    readonly status?: number,
    readonly canFallback = false
  )
  {
    super(message);
    this.name = 'AiHttpError';
  }
}

/**
 * One real request with the user's settings, so Settings can say which protocol answered (Auto
 * tries Responses, then Chat Completions) and how long it took.
 */
export class AiConnectionCheck
{
  async run(settings: AiSettings): Promise<AiConnectionCheckResult>
  {
    this.#validateRequiredSettings(settings);
    const startedAt = performance.now();
    const protocol = await this.#requestWithFallback(settings);
    return {
      protocol,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  #validateRequiredSettings(settings: AiSettings): void
  {
    if (!settings.baseUrl.trim()) throw new Error('Base URL is required');
    if (!settings.apiKey.trim()) throw new Error('API Key is required');
    if (!settings.model.trim()) throw new Error('Model is required');
  }

  async #requestWithFallback(settings: AiSettings): Promise<ResolvedAiApiProtocol>
  {
    const candidates = resolveAiEndpointCandidates(settings.baseUrl, settings.protocol);
    let firstError: unknown;

    for (const [index, candidate] of candidates.entries())
    {
      try
      {
        const payload = await this.#requestCandidate(settings, candidate);
        // Throws when the reply has no text, which fails the check without trying the next protocol.
        extractAiResponseText(candidate.protocol, payload);
        return candidate.protocol;
      }
      catch (error)
      {
        firstError ??= error;
        const canFallback = index < candidates.length - 1 &&
          error instanceof AiHttpError && error.canFallback;
        if (!canFallback) throw error;
      }
    }

    throw firstError instanceof Error ? firstError : new Error('AI request failed');
  }

  async #requestCandidate(
    settings: AiSettings,
    candidate: AiEndpointCandidate
  ): Promise<unknown>
  {
    const body = buildAiRequestBody(settings, candidate.protocol, CHECK_PROMPT);

    let response: Response;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try
    {
      response = await fetch(candidate.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey.trim()}`,
        },
        body: JSON.stringify(body),
        credentials: 'omit',
        signal: controller.signal,
      });
    }
    catch
    {
      throw new AiHttpError('Unable to connect to the API');
    }
    finally
    {
      window.clearTimeout(timeout);
    }

    if (!response.ok)
    {
      const responseText = await response.text().catch(() => '');
      const canFallback = aiEndpointLacksProtocol(response.status, responseText);
      throw new AiHttpError(aiHttpStatusMessage(response.status), response.status, canFallback);
    }

    try
    {
      return await response.json();
    }
    catch
    {
      throw new AiHttpError('The API returned invalid JSON', response.status);
    }
  }
}
