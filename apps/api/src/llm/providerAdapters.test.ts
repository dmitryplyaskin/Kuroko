import { expect, test } from 'bun:test';
import { defaultConnectionSettings } from '@kuroko/contracts/connectionSettings';
import type { LlmMessage } from '@kuroko/contracts/llm';
import { createProviderConnections } from '../connection/providerConnections';
import { providerAdapters, type GenerationInput } from './providerAdapters';
import { ProviderOutput } from './providerResponse';

async function* frames(values: object[]) {
  for (const value of values) yield { data: JSON.stringify(value) };
}

test('OpenRouter keeps tool calls at the position of their first delta', async () => {
  const output = new ProviderOutput();
  const chunk = (delta: object, finish_reason?: string) => ({ data: JSON.stringify({ choices: [{ delta, finish_reason }] }) });
  async function* stream() {
    yield chunk({ content: 'Before.' });
    yield chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'weather', arguments: '{' } }] });
    yield chunk({ content: 'Between.' });
    yield chunk({ tool_calls: [{ index: 0, function: { arguments: '}' } },
      { index: 1, id: 'call_2', function: { name: 'weather', arguments: '{}' } }] }, 'tool_calls');
    yield { data: '[DONE]' };
  }
  expect(await Array.fromAsync(providerAdapters.openrouter.read(stream(), output, true))).toEqual([
    { type: 'text_delta', text: 'Before.' }, { type: 'text_delta', text: 'Between.' },
  ]);
  expect(output.parts).toMatchObject([
    { type: 'text', text: 'Before.' }, { type: 'toolCall', id: 'call_1' },
    { type: 'text', text: 'Between.' }, { type: 'toolCall', id: 'call_2' },
  ]);
});

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
    { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'Checking the city.' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'signature_delta', signature: 'signed' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'redacted_thinking', data: 'opaque' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'toolu_1', name: 'weather', input: {} } },
    { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
    { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '"Oslo"}' } },
    { type: 'content_block_stop', index: 3 },
    { type: 'content_block_start', index: 4, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 4, delta: { type: 'text_delta', text: 'Last.' } },
    { type: 'content_block_stop', index: 4 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 5, output_tokens: 11 } },
    { type: 'message_stop' },
  ];
  expect(await Array.fromAsync(adapter.read(frames(events), output, true))).toEqual([
    { type: 'text_delta', text: 'First.' }, { type: 'reasoning_delta', text: 'Checking the city.' }, { type: 'text_delta', text: 'Last.' },
  ]);
  expect(output.reasoningText).toBe('Checking the city.');
  expect(output.finish).toEqual({ reason: 'tool_calls', raw: 'tool_use' });
  expect(output.usage).toEqual({ inputTokens: 17, outputTokens: 11 });
  expect(output.parts).toEqual([
    { type: 'text', text: 'First.', geminiSignature: undefined },
    { type: 'anthropicThinking', block: { type: 'thinking', thinking: 'Checking the city.', signature: 'signed' } },
    { type: 'anthropicThinking', block: { type: 'redacted_thinking', data: 'opaque' } },
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
        { type: 'text', text: 'First.' }, { type: 'thinking', thinking: 'Checking the city.', signature: 'signed' },
        { type: 'redacted_thinking', data: 'opaque' }, { type: 'tool_use', id: 'toolu_1', name: 'weather', input: { city: 'Oslo' } },
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
  expect(json.parts[0]).toEqual(output.parts[3]);
  expect(adapter.request({
    ...input, includeReasoning: true, toolChoice: 'auto', settings: { ...defaultConnectionSettings, model: 'claude-sonnet-4-6' },
  })).toMatchObject({ thinking: { type: 'adaptive', display: 'summarized' } });
});

test('Gemini replays parallel results in call order and keeps signatures attached to their parts', async () => {
  const adapter = providerAdapters.gemini;
  const output = new ProviderOutput();
  const parts = [
    { text: 'Second thought.', thought: true, thoughtSignature: 'signed-thought' },
    { text: 'Checking.' },
    { functionCall: { id: 'native-1', name: 'weather', args: { city: 'Oslo' } }, thoughtSignature: 'signed-call' },
    { functionCall: { name: 'weather', args: { city: 'Riga' } } },
    { text: '', thoughtSignature: 'signed-text' },
  ];
  const response = [{
    candidates: [{ content: { parts: [{ text: 'First thought. ', thought: true }, ...parts] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, thoughtsTokenCount: 2, totalTokenCount: 17 },
  }];
  expect(await Array.fromAsync(adapter.read(frames(response), output))).toEqual([
    { type: 'reasoning_delta', text: 'First thought. ' },
    { type: 'reasoning_delta', text: 'Second thought.' }, { type: 'text_delta', text: 'Checking.' },
  ]);
  expect(output.usage).toEqual({ inputTokens: 5, outputTokens: 12, totalTokens: 17 });
  const calls = output.parts.filter((part) => part.type === 'toolCall');
  expect(calls[1]?.id).toStartWith('call_');
  const followUp = adapter.request({
    ...input, includeReasoning: true, settings: { ...input.settings, model: 'gemini-2.5-pro' },
    toolChoice: { name: 'weather' }, messages: [
      ...messages, { role: 'assistant', parts: output.parts },
      { role: 'tool', callId: calls[1]!.id, content: 21 },
      { role: 'tool', callId: 'native-1', content: { temperature: 18 } },
    ],
  });
  expect(JSON.parse(JSON.stringify(followUp))).toEqual({
    systemInstruction: { parts: [{ text: 'Use Celsius.' }] },
    generationConfig: { maxOutputTokens: 60, temperature: 0, topK: 8, thinkingConfig: { includeThoughts: true } },
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

test('reads public reasoning from a compatible JSON response', async () => {
  const output = new ProviderOutput();
  const response = { choices: [{ message: { reasoning_content: 'Compare the dates.', content: 'The second date is earlier.' }, finish_reason: 'stop' }] };
  expect(await Array.fromAsync(providerAdapters.custom.read(frames([response]), output, false))).toEqual([
    { type: 'reasoning_delta', text: 'Compare the dates.' }, { type: 'text_delta', text: 'The second date is earlier.' },
  ]);
  expect(output.parts).toMatchObject([{ type: 'text', text: 'The second date is earlier.' }]);
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
  expect(() => createProviderConnections({ OPENAI_GENERATION_PATH: '//another.host/v1' })).toThrow('config_provider_generation_path_invalid');
});
