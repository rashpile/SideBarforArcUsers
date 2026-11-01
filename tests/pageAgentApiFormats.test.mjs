import assert from 'node:assert/strict';
import test from 'node:test';

import { ResponsesFormat } from '../src/services/pageAgent/pageAgentApiFormats.ts';

const IMAGE = 'data:image/jpeg;base64,AAAA';

const TOOLS = [
  {
    type: 'function',
    function: { name: 'inspect', description: 'Measure elements.', parameters: { type: 'object', properties: {} } },
  },
];

test('a Responses tool-call round trip keeps call ids paired and sends the screenshot as input_image', () =>
{
  const format = new ResponsesFormat();

  const assistant = format.parse({
    status: 'completed',
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Measuring first.' }] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_a', name: 'get_page_outline', arguments: '{}' },
      { type: 'function_call', id: 'fc_2', call_id: 'call_b', name: 'inspect', arguments: '{"selectors":["iframe"]}' },
    ],
  });

  assert.deepEqual(assistant, {
    role: 'assistant',
    content: 'Measuring first.',
    tool_calls: [
      { id: 'call_a', type: 'function', function: { name: 'get_page_outline', arguments: '{}' } },
      { id: 'call_b', type: 'function', function: { name: 'inspect', arguments: '{"selectors":["iframe"]}' } },
    ],
  });

  // The run's next request, in the Chat Completions shape the run keeps.
  const messages = [
    { role: 'system', content: 'You change how the page looks.' },
    { role: 'user', content: 'Request: make the player full width' },
    assistant,
    { role: 'tool', tool_call_id: 'call_a', content: '{"outline":[]}' },
    { role: 'tool', tool_call_id: 'call_b', content: '[{"selector":"iframe","count":1}]' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Screenshot of the visible part of the page.' },
        { type: 'image_url', image_url: { url: IMAGE } },
      ],
    },
  ];

  const body = format.body({ messages, tools: TOOLS }, { model: 'gpt-test', reasoningEffort: 'low' });

  assert.equal(body.instructions, 'You change how the page looks.');
  assert.deepEqual(body.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'Request: make the player full width' }] },
    { role: 'assistant', content: 'Measuring first.' },
    // Only call_id goes back, not the fc_ item id: the reasoning items it belonged with are dropped.
    { type: 'function_call', call_id: 'call_a', name: 'get_page_outline', arguments: '{}' },
    { type: 'function_call', call_id: 'call_b', name: 'inspect', arguments: '{"selectors":["iframe"]}' },
    { type: 'function_call_output', call_id: 'call_a', output: '{"outline":[]}' },
    { type: 'function_call_output', call_id: 'call_b', output: '[{"selector":"iframe","count":1}]' },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Screenshot of the visible part of the page.' },
        { type: 'input_image', image_url: IMAGE },
      ],
    },
  ]);
  assert.deepEqual(body.tools, [
    { type: 'function', name: 'inspect', description: 'Measure elements.', parameters: { type: 'object', properties: {} }, strict: false },
  ]);
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.equal(body.store, false);
  assert.equal('reasoning_effort' in body, false);
});
