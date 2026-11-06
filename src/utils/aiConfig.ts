export type AiApiProtocol = 'auto' | 'responses' | 'chat-completions';
export type ResolvedAiApiProtocol = Exclude<AiApiProtocol, 'auto'>;
export type AiReasoningEffort = 'off' | 'low' | 'medium' | 'high';

export interface AiSettings
{
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: AiApiProtocol;
  reasoningEffort: AiReasoningEffort;
  acceptsImages: boolean;
  /** Holds only the plugins the user switched; read it through `PageAgentPluginSwitches`, which adds the defaults. */
  agentPlugins: Record<string, boolean>;
}

export interface AiEndpointCandidate
{
  protocol: ResolvedAiApiProtocol;
  url: string;
}

export const AI_SETTINGS_STORAGE_KEY = 'sidebar-ai-rename-settings';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  protocol: 'auto',
  reasoningEffort: 'medium',
  acceptsImages: false,
  agentPlugins: {},
};

const SECRET_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'key',
  'token',
  'access_token',
]);

/**
 * Fields added in later versions get their default values.
 */
export function parseAiSettings(value: string): AiSettings
{
  const parsed = JSON.parse(value) as Partial<AiSettings>;
  const protocol: AiApiProtocol = parsed.protocol === 'responses' ||
    parsed.protocol === 'chat-completions' || parsed.protocol === 'auto'
    ? parsed.protocol
    : 'auto';
  const reasoningEffort: AiReasoningEffort = parsed.reasoningEffort === 'off' ||
    parsed.reasoningEffort === 'low' || parsed.reasoningEffort === 'medium' ||
    parsed.reasoningEffort === 'high'
    ? parsed.reasoningEffort
    : 'medium';

  return {
    ...DEFAULT_AI_SETTINGS,
    ...parsed,
    protocol,
    reasoningEffort,
    acceptsImages: parsed.acceptsImages === true,
    agentPlugins: parseAgentPluginSwitches(parsed.agentPlugins),
  };
}

/** A non-boolean entry would read as on or off by accident, so it is dropped and the plugin's default applies. */
function parseAgentPluginSwitches(value: unknown): Record<string, boolean>
{
  if (typeof value !== 'object' || value === null || Array.isArray(value))
  {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter(([, enabled]) => typeof enabled === 'boolean'));
}

/**
 * One builder for both OpenAI-style protocols keeps the output limit and reasoning settings equal.
 */
export function buildAiRequestBody(
  settings: AiSettings,
  protocol: ResolvedAiApiProtocol,
  prompt: string
): Record<string, unknown>
{
  if (protocol === 'responses')
  {
    return {
      model: settings.model.trim(),
      input: prompt,
      max_output_tokens: 100,
      ...(settings.reasoningEffort !== 'off' && {
        reasoning: { effort: settings.reasoningEffort },
      }),
    };
  }

  return {
    model: settings.model.trim(),
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 100,
    ...(settings.reasoningEffort !== 'off' && {
      reasoning_effort: settings.reasoningEffort,
    }),
  };
}

/**
 * The URL parser rewrites every IPv4 form (`127.1`, `0x7f.0.0.1`) to dotted decimal, so the regex
 * sees the canonical address; `127.0.0.1.example.com` stays a domain and fails it.
 */
function isLoopbackHost(hostname: string): boolean
{
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || hostname === '[::1]';
}

/**
 * Validates the Base URL, so a key put in it can't leak through logs, history or error messages.
 * The API key and the page text must not cross the network unencrypted, so plain HTTP is allowed
 * only for a server on this computer (Ollama, LM Studio).
 */
export function parseSafeHttpUrl(value: string): URL
{
  let url: URL;
  try
  {
    url = new URL(value.trim());
  }
  catch
  {
    throw new Error('Base URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
  {
    throw new Error('Base URL must use HTTP or HTTPS');
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname))
  {
    throw new Error('Base URL must use HTTPS (HTTP is allowed only for localhost)');
  }
  if (url.username || url.password)
  {
    throw new Error('Do not include credentials in the Base URL');
  }

  // An API version is not a secret; other common secret parameters must be rejected explicitly.
  for (const key of url.searchParams.keys())
  {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase()))
    {
      throw new Error('Do not include an API key or token in the Base URL');
    }
  }

  url.hash = '';
  return url;
}

/**
 * A full endpoint URL is recognized instead of being appended to again.
 */
export function normalizeAiEndpoint(
  baseUrl: string,
  protocol: ResolvedAiApiProtocol
): string
{
  const url = parseSafeHttpUrl(baseUrl);
  const endpoint = protocol === 'responses' ? 'responses' : 'chat/completions';
  let path = url.pathname.replace(/\/+$/, '');

  if (/\/(responses|chat\/completions)$/i.test(path))
  {
    path = path.replace(/\/(responses|chat\/completions)$/i, `/${endpoint}`);
  }
  else if (!path)
  {
    path = `/v1/${endpoint}`;
  }
  else
  {
    path = `${path}/${endpoint}`;
  }

  url.pathname = path;
  return url.toString();
}

/**
 * Auto returns two candidates only when the Base URL has no explicit endpoint.
 */
export function resolveAiEndpointCandidates(
  baseUrl: string,
  protocol: AiApiProtocol
): AiEndpointCandidate[]
{
  const parsed = parseSafeHttpUrl(baseUrl);
  const explicitMatch = parsed.pathname.match(/\/(responses|chat\/completions)\/?$/i);

  if (protocol === 'responses' || protocol === 'chat-completions')
  {
    return [{ protocol, url: normalizeAiEndpoint(baseUrl, protocol) }];
  }

  if (explicitMatch)
  {
    const inferred = explicitMatch[1].toLowerCase() === 'responses'
      ? 'responses'
      : 'chat-completions';
    return [{ protocol: inferred, url: normalizeAiEndpoint(baseUrl, inferred) }];
  }

  return [
    { protocol: 'responses', url: normalizeAiEndpoint(baseUrl, 'responses') },
    { protocol: 'chat-completions', url: normalizeAiEndpoint(baseUrl, 'chat-completions') },
  ];
}

/**
 * Whether an error answer means the endpoint lacks this protocol, so Auto tries the next candidate.
 * A 404 that names the model is a wrong model name, which the other protocol wouldn't fix.
 */
export function aiEndpointLacksProtocol(status: number, responseText: string): boolean
{
  return status === 405 || (status === 404 && !/\bmodel\b/i.test(responseText));
}

/**
 * Shared by the connection check in Settings and the page agent, so both say the same thing for the
 * same failure.
 */
export function aiHttpStatusMessage(status: number): string
{
  if (status === 401) return 'The API Key is invalid';
  if (status === 403) return 'The API Key does not have permission to use this service';
  if (status === 404) return 'The API endpoint or model was not found';
  if (status === 405) return 'The selected API protocol is not supported by this endpoint';
  if (status === 429) return 'The API rate limit or quota was exceeded';
  if (status >= 500) return `The API service returned HTTP ${status}`;
  return `The API request failed with HTTP ${status}`;
}

export function getHostPermissionPattern(urlValue: string): string
{
  const url = parseSafeHttpUrl(urlValue);
  return `${url.origin}/*`;
}

/**
 * Reads only the protocol's text fields, so reasoning or tool call content alone doesn't count as a
 * reply.
 */
export function extractAiResponseText(
  protocol: ResolvedAiApiProtocol,
  payload: unknown
): string
{
  const data = payload as Record<string, unknown> | null;
  if (!data || typeof data !== 'object')
  {
    throw new Error('The API returned an invalid JSON response');
  }

  if (protocol === 'responses')
  {
    if (typeof data.output_text === 'string' && data.output_text.trim())
    {
      return data.output_text;
    }

    const output = Array.isArray(data.output) ? data.output : [];
    const texts: string[] = [];
    for (const item of output)
    {
      const content = typeof item === 'object' && item !== null &&
        Array.isArray((item as Record<string, unknown>).content)
        ? (item as Record<string, unknown>).content as unknown[]
        : [];
      for (const part of content)
      {
        if (typeof part !== 'object' || part === null) continue;
        const record = part as Record<string, unknown>;
        if (record.type === 'output_text' && typeof record.text === 'string')
        {
          texts.push(record.text);
        }
      }
    }
    if (texts.some(text => text.trim())) return texts.join('\n');
  }
  else
  {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === 'string' && message.content.trim())
    {
      return message.content;
    }
    if (Array.isArray(message?.content))
    {
      const texts = message.content
        .filter((part): part is Record<string, unknown> => typeof part === 'object' && part !== null)
        .filter(part => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text as string);
      if (texts.some(text => text.trim())) return texts.join('\n');
    }
  }

  throw new Error('The API response did not contain text');
}

/**
 * The page agent re-applies its changes, and calls a navigation same-site, only on the origin they
 * were made on, so a script never runs on a site the user didn't approve it for.
 * Protocols are checked explicitly because every `file:` URL has the origin "null".
 */
export function isSameOriginHttpUrl(url: string, pageUrl: string): boolean
{
  let link: URL;
  let page: URL;
  try
  {
    link = new URL(url);
    page = new URL(pageUrl);
  }
  catch
  {
    return false;
  }

  const isHttp = (value: URL) => value.protocol === 'http:' || value.protocol === 'https:';
  return isHttp(link) && isHttp(page) && link.origin === page.origin;
}
