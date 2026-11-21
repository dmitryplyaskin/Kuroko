import { expect, test } from 'bun:test';
import { defaultConnectionSettings } from '@kuroko/contracts/connectionSettings';
import type { LlmMessage } from '@kuroko/contracts/llm';
import { createProviderConnections } from '../connection/providerConnections';
import { providerAdapters, type GenerationInput } from './providerAdapters';
import { ProviderOutput } from './providerResponse';

async function* frames(values: object[]) {
  for (const value of values) yield { data: JSON.stringify(value) };
}

const tool = { name: 'weather', parameters: { type: 'object' } };
const messages: LlmMessage[] = [
  { role: 'system', content: 'Use Celsius.' },
  { role: 'user', content: 'What is the forecast?' },
];
const input: GenerationInput = {
  settings: { ...defaultConnectionSettings, model: 'model', responseTokens: 60, temperature: 0, topK: 8 },
  messages, tools: [tool], toolChoice: 'required', stream: true,
};

test('Anthropic accepts native settings and streams mixed text, tools and cumulative usage', async () => {
  const adapter = providerAdapters.anthropic;
  const output = new ProviderOutput();
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 12, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'First.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'weather', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"Oslo"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Last.' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 5, output_tokens: 11 } },
    { type: 'message_stop' },
  ];
  expect(await Array.fromAsync(adapter.read(frames(events), output, true))).toEqual(['First.', 'Last.']);
  expect(output.finish).toEqual({ reason: 'tool_calls', raw: 'tool_use' });
  expect(output.usage).toEqual({ inputTokens: 17, outputTokens: 11 });
  expect(output.parts).toEqual([
    { type: 'text', text: 'First.', geminiSignature: undefined },
    { type: 'toolCall', id: 'toolu_1', name: 'weather', arguments: { city: 'Oslo' } },
    { type: 'text', text: 'Last.', geminiSignature: undefined },
  ]);
  const followUp = adapter.request({
    ...input, stream: false, messages: [
      ...messages, { role: 'assistant', parts: output.parts },
      { role: 'tool', callId: 'toolu_1', content: 'Unavailable', isError: true },
    ],
  });
  expect(followUp).toMatchObject({
    system: 'Use Celsius.', max_tokens: 60, top_k: 8, temperature: 0,
    tool_choice: { type: 'any' }, tools: [{ name: 'weather', input_schema: { type: 'object' } }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'What is the forecast?' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'First.' }, { type: 'tool_use', id: 'toolu_1', name: 'weather', input: { city: 'Oslo' } },
        { type: 'text', text: 'Last.' },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Unavailable', is_error: true }] },
    ],
  });

  const json = new ProviderOutput();
  await Array.fromAsync(adapter.read(frames([{
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'weather', input: { city: 'Oslo' } }], stop_reason: 'tool_use',
  }]), json, false));
  expect(json.parts).toHaveLength(1);
  expect(json.parts[0]).toEqual(output.parts[1]);
});

test('Gemini replays parallel results in call order and keeps signatures attached to their parts', async () => {
  const adapter = providerAdapters.gemini;
  const output = new ProviderOutput();
  const parts = [
    { text: 'Checking.' },
    { functionCall: { id: 'native-1', name: 'weather', args: { city: 'Oslo' } }, thoughtSignature: 'signed-call' },
    { functionCall: { name: 'weather', args: { city: 'Riga' } } },
    { text: '', thoughtSignature: 'signed-text' },
  ];
  const response = [{
    candidates: [{ content: { parts }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, thoughtsTokenCount: 2, totalTokenCount: 17 },
  }];
  expect(await Array.fromAsync(adapter.read(frames(response), output))).toEqual(['Checking.']);
  expect(output.usage).toEqual({ inputTokens: 5, outputTokens: 12, totalTokens: 17 });
  const calls = output.parts.filter((part) => part.type === 'toolCall');
  expect(calls[1]?.id).toStartWith('call_');
  const followUp = adapter.request({
    ...input, toolChoice: { name: 'weather' }, messages: [
      ...messages, { role: 'assistant', parts: output.parts },
      { role: 'tool', callId: calls[1]!.id, content: 21 },
      { role: 'tool', callId: 'native-1', content: { temperature: 18 } },
    ],
  });
  expect(JSON.parse(JSON.stringify(followUp))).toEqual({
    systemInstruction: { parts: [{ text: 'Use Celsius.' }] },
    generationConfig: { maxOutputTokens: 60, temperature: 0, topK: 8 },
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['weather'] } },
    tools: [{ functionDeclarations: [{ name: 'weather', parametersJsonSchema: { type: 'object' } }] }],
    contents: [
      { role: 'user', parts: [{ text: 'What is the forecast?' }] },
      { role: 'model', parts },
      { role: 'user', parts: [
        { functionResponse: { id: 'native-1', name: 'weather', response: { output: { temperature: 18 } } } },
        { functionResponse: { name: 'weather', response: { output: 21 } } },
      ] },
    ],
  });
});

test('generation URLs use the configured server base and the provider protocol', () => {
  const connections = createProviderConnections({
    OPENAI_BASE_URL: 'http://localhost:4000/proxy/v1',
    OPENAI_GENERATION_PATH: 'compat/completions',
  });
  expect(connections.openai.generationUrl('model', false).href).toBe('http://localhost:4000/proxy/v1/compat/completions');
  expect(connections.openai.catalogUrl('models').href).toBe('http://localhost:4000/proxy/v1/models');
  expect(connections.anthropic.generationUrl('model', false).href).toBe('https://api.anthropic.com/v1/messages');
  expect(connections.gemini.generationUrl('gemini-model', false).href)
    .toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-model:generateContent');
  expect(connections.gemini.generationUrl('gemini-model', true).href)
    .toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-model:streamGenerateContent?alt=sse');
  expect(() => createProviderConnections({ OPENAI_GENERATION_PATH: '//another.host/v1' })).toThrow('Invalid OPENAI_GENERATION_PATH');
});
