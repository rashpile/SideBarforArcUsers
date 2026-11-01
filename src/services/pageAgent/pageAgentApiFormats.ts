// What a page agent request and answer look like in each OpenAI-style API. The run keeps its
// conversation in the Chat Completions shape; the Responses format translates it on every request.
// No HTTP in here, so Node tests check the translation directly.

import type { AiReasoningEffort, ResolvedAiApiProtocol } from '../../utils/aiConfig.ts';
import { PageAgentModelError } from './pageAgentRun.ts';
import type {
  PageAgentAssistantMessage,
  PageAgentContentPart,
  PageAgentMessage,
  PageAgentModelRequest,
  PageAgentToolCall,
} from './pageAgentRun.ts';

// Room for a whole stylesheet plus the reasoning tokens that count against the same limit.
const MAX_OUTPUT_TOKENS = 16_000;

const OUTPUT_LIMIT_ERROR = 'The model used up its output limit before answering; try a lower reasoning effort';

export interface PageAgentModelOptions
{
  model: string;
  reasoningEffort: AiReasoningEffort;
}

export interface PageAgentApiFormat
{
  body(request: PageAgentModelRequest, options: PageAgentModelOptions): Record<string, unknown>;
  parse(payload: unknown): PageAgentAssistantMessage;
}

export class ChatCompletionsFormat implements PageAgentApiFormat
{
  body(request: PageAgentModelRequest, options: PageAgentModelOptions): Record<string, unknown>
  {
    return {
      model: options.model,
      messages: request.messages,
      tools: request.tools,
      tool_choice: 'auto',
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      ...(options.reasoningEffort !== 'off' && { reasoning_effort: options.reasoningEffort }),
    };
  }

  parse(payload: unknown): PageAgentAssistantMessage
  {
    const choices = asRecord(payload)?.choices;
    const choice = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
    const message = asRecord(choice?.message);
    if (!choice || !message)
    {
      throw new PageAgentModelError('The API response did not contain a message');
    }

    const toolCalls: PageAgentToolCall[] = [];
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    rawCalls.forEach((entry, index) =>
    {
      const call = asRecord(entry);
      const fn = asRecord(call?.function);
      if (call && fn)
      {
        toolCalls.push(toolCall(asString(call.id), index, fn.name, fn.arguments));
      }
    });
    // A refusal comes in its own field with content null; showing it beats "answered without a report".
    const content = chatMessageText(message.content) ?? asString(message.refusal) ?? null;
    return assistantMessage(content, toolCalls, choice.finish_reason === 'length');
  }
}

export class ResponsesFormat implements PageAgentApiFormat
{
  body(request: PageAgentModelRequest, options: PageAgentModelOptions): Record<string, unknown>
  {
    const instructions: string[] = [];
    const input: Record<string, unknown>[] = [];
    for (const message of request.messages)
    {
      if (message.role === 'system')
      {
        instructions.push(message.content);
      }
      else
      {
        input.push(...responsesItems(message));
      }
    }

    return {
      model: options.model,
      ...(instructions.length > 0 && { instructions: instructions.join('\n\n') }),
      input,
      tools: request.tools.map(tool => ({
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        // Strict mode needs every property in `required`, and set_conditions has an optional
        // `replaced`; false keeps the schemas valid whatever the provider's default is.
        strict: false,
      })),
      tool_choice: 'auto',
      max_output_tokens: MAX_OUTPUT_TOKENS,
      ...(options.reasoningEffort !== 'off' && { reasoning: { effort: options.reasoningEffort } }),
      store: false,
    };
  }

  // Reasoning items are skipped: with store false the next request can't refer to them, so the
  // function calls go back with their call_id only, not with the `fc_` item id that belongs with them.
  parse(payload: unknown): PageAgentAssistantMessage
  {
    const data = asRecord(payload);
    const output = data?.output;
    if (!data || !Array.isArray(output))
    {
      throw new PageAgentModelError('The API response did not contain any output');
    }

    const toolCalls: PageAgentToolCall[] = [];
    const texts: string[] = [];
    const refusals: string[] = [];
    output.forEach((entry, index) =>
    {
      const item = asRecord(entry);
      if (item?.type === 'function_call')
      {
        toolCalls.push(toolCall(asString(item.call_id), index, item.name, item.arguments));
      }
      else if (item?.type === 'message' && Array.isArray(item.content))
      {
        for (const part of item.content.map(asRecord))
        {
          if (part?.type === 'output_text' && typeof part.text === 'string')
          {
            texts.push(part.text);
          }
          else if (part?.type === 'refusal' && typeof part.refusal === 'string')
          {
            refusals.push(part.refusal);
          }
        }
      }
    });

    const content = texts.length > 0 ? texts.join('\n') : refusals.length > 0 ? refusals.join('\n') : null;
    const cutOff = data.status === 'incomplete' && asRecord(data.incomplete_details)?.reason === 'max_output_tokens';
    return assistantMessage(content, toolCalls, cutOff);
  }
}

export function pageAgentApiFormat(protocol: ResolvedAiApiProtocol): PageAgentApiFormat
{
  return protocol === 'responses' ? new ResponsesFormat() : new ChatCompletionsFormat();
}

export function asRecord(value: unknown): Record<string, unknown> | undefined
{
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function asString(value: unknown): string | undefined
{
  return typeof value === 'string' ? value : undefined;
}

// The call id goes back as the Responses `call_id` of both the call and its output, which is how
// the API pairs them.
function responsesItems(message: Exclude<PageAgentMessage, { role: 'system' }>): Record<string, unknown>[]
{
  switch (message.role)
  {
    case 'user':
      return [{ role: 'user', content: responsesUserContent(message.content) }];
    case 'assistant':
    {
      const items: Record<string, unknown>[] = [];
      if (message.content?.trim())
      {
        items.push({ role: 'assistant', content: message.content });
      }
      for (const call of message.tool_calls ?? [])
      {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
      return items;
    }
    case 'tool':
      return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
  }
}

function responsesUserContent(content: string | PageAgentContentPart[]): Record<string, unknown>[]
{
  if (typeof content === 'string')
  {
    return [{ type: 'input_text', text: content }];
  }
  return content.map(part => part.type === 'text'
    ? { type: 'input_text', text: part.text }
    : { type: 'input_image', image_url: part.image_url.url });
}

// Some providers send the arguments as an object or omit the id; the run needs JSON text, and an
// id made up here goes back with the assistant message, so the tool results still match.
function toolCall(id: string | undefined, index: number, name: unknown, args: unknown): PageAgentToolCall
{
  const argumentsText = typeof args === 'string'
    ? args
    : args === undefined || args === null ? '' : JSON.stringify(args);
  return {
    id: id || `call_${index}`,
    type: 'function',
    function: { name: asString(name) ?? '', arguments: argumentsText },
  };
}

// Reasoning tokens count against the output limit, so an answer cut off before any text or tool
// call says so instead of ending as "answered without a report".
function assistantMessage(
  content: string | null,
  toolCalls: PageAgentToolCall[],
  cutOff: boolean,
): PageAgentAssistantMessage
{
  if (toolCalls.length === 0 && !content?.trim() && cutOff)
  {
    throw new PageAgentModelError(OUTPUT_LIMIT_ERROR);
  }
  return {
    role: 'assistant',
    content,
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };
}

function chatMessageText(content: unknown): string | undefined
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
