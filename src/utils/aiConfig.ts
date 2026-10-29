export type AiApiProtocol = 'auto' | 'responses' | 'chat-completions';
export type ResolvedAiApiProtocol = Exclude<AiApiProtocol, 'auto'>;
export type AiReasoningEffort = 'off' | 'low' | 'medium' | 'high';

export interface AiRenameSettings
{
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: AiApiProtocol;
  reasoningEffort: AiReasoningEffort;
  prompt: string;
  autoRename: boolean;
}

export interface AiEndpointCandidate
{
  protocol: ResolvedAiApiProtocol;
  url: string;
}

export interface PageContentCandidates
{
  pageMarkdown?: string;
  matchedLlmsMarkdown?: string;
  llmsSummary?: string;
  cleanedPage?: string;
}

export interface SelectedPageContent
{
  source: 'page-markdown' | 'llms-txt' | 'cleaned-page' | 'metadata-only';
  content: string;
  siteContext?: string;
}

export const AI_SETTINGS_STORAGE_KEY = 'sidebar-ai-rename-settings';

export const DEFAULT_AI_PROMPT = `根据提供的网页内容，为这个固定 Tab 或书签生成一个简短、易于扫读的名称。

要求：
- 使用网页内容的主要语言。
- 中文名称通常为 4 到 12 个字；英文名称通常为 2 到 8 个词。
- 保留区分这个页面所需的关键信息。
- 删除网站名重复、营销文案和无意义后缀。
- 不使用引号、emoji 或句末标点。
- 不添加“网页”“页面”“网站”等无信息量词语。
- 只返回名称，不提供解释。`;

export const DEFAULT_AI_RENAME_SETTINGS: AiRenameSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  protocol: 'auto',
  reasoningEffort: 'medium',
  prompt: DEFAULT_AI_PROMPT,
  autoRename: false,
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
export function parseAiRenameSettings(value: string): AiRenameSettings
{
  const parsed = JSON.parse(value) as Partial<AiRenameSettings>;
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
    ...DEFAULT_AI_RENAME_SETTINGS,
    ...parsed,
    protocol,
    reasoningEffort,
    autoRename: parsed.autoRename === true,
  };
}

/**
 * One builder for both OpenAI-style protocols keeps the output limit and reasoning settings equal.
 */
export function buildAiRequestBody(
  settings: AiRenameSettings,
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
 * Validates the Base URL, so a key put in it can't leak through logs, history or error messages.
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

export function getHostPermissionPattern(urlValue: string): string
{
  const url = parseSafeHttpUrl(urlValue);
  return `${url.origin}/*`;
}

/**
 * Reads only the protocol's text fields, so reasoning or tool call content never becomes the title.
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
 * Multi-line or too-long output counts as a protocol failure, since silent truncation could
 * change the meaning.
 */
export function sanitizeGeneratedTitle(value: string): string
{
  const nonEmptyLines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (nonEmptyLines.length !== 1)
  {
    throw new Error('The model must return exactly one line');
  }

  let title = nonEmptyLines[0].replace(/\s+/g, ' ').trim();
  const pairs: Array<[string, string]> = [['"', '"'], ["'", "'"], ['`', '`'], ['“', '”'], ['‘', '’']];
  for (const [start, end] of pairs)
  {
    if (title.startsWith(start) && title.endsWith(end) && title.length > start.length + end.length)
    {
      title = title.slice(start.length, -end.length).trim();
      break;
    }
  }

  title = title.replace(/[。.!！?？]+$/, '').trim();
  if (!title) throw new Error('The model returned an empty title');
  if (title.length > 100) throw new Error('The model returned a title longer than 100 characters');
  return title;
}

/**
 * The llms.txt site summary serves only as supplementary context.
 */
export function selectPageContent(candidates: PageContentCandidates): SelectedPageContent
{
  const pageMarkdown = candidates.pageMarkdown?.trim();
  const matchedLlmsMarkdown = candidates.matchedLlmsMarkdown?.trim();
  const cleanedPage = candidates.cleanedPage?.trim();
  const siteContext = candidates.llmsSummary?.trim();

  if (pageMarkdown)
  {
    return { source: 'page-markdown', content: pageMarkdown, siteContext };
  }
  if (matchedLlmsMarkdown)
  {
    return { source: 'llms-txt', content: matchedLlmsMarkdown, siteContext };
  }
  if (cleanedPage)
  {
    return { source: 'cleaned-page', content: cleanedPage, siteContext };
  }
  return { source: 'metadata-only', content: '', siteContext };
}

/**
 * From the current path up to the site root; more specific paths come first.
 */
export function buildLlmsTxtCandidates(pageUrl: string, maxCandidates = 5): string[]
{
  const url = new URL(pageUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length > 0 && segments[segments.length - 1].includes('.')) segments.pop();

  const candidates: string[] = [];
  for (let count = segments.length; count >= 0 && candidates.length < maxCandidates; count -= 1)
  {
    const prefix = segments.slice(0, count).join('/');
    candidates.push(`${url.origin}/${prefix ? `${prefix}/` : ''}llms.txt`);
  }
  return [...new Set(candidates)];
}
