import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import {
  anthropicToOpenAIChat,
  openaiToAnthropicJson,
  openaiToAnthropicStream,
  morphEffortFromThinking,
  UnsupportedContentError
} from '../src/index.mjs'

import { execFileSync } from 'node:child_process'

const MODEL = 'anthropic-morph-kimik31'
const originalStream = execFileSync('git', ['show', '15e3d63:src/stream.mjs'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8'
}).replace("from './response.mjs'", `from '${new URL('../src/response.mjs', import.meta.url).href}'`)
const { openaiToAnthropicStream: baselineStream } = await import(`data:text/javascript;base64,${Buffer.from(originalStream).toString('base64')}`)

function request (extra = {}) {
  return anthropicToOpenAIChat({
    model: MODEL,
    max_tokens: 10,
    messages: [{ role: 'user', content: 'ok' }],
    ...extra
  })
}

function encode (chunks, done = true) {
  const frames = chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n')
  if (done) frames.push('data: [DONE]\n\n')
  return frames
}

async function collectStream (chunks, { done = true, requested = MODEL, split = false, converter = openaiToAnthropicStream } = {}) {
  const frames = encode(chunks, done)
  let input
  if (split && frames.length > 1) {
    input = frames.map(frame => [frame.slice(0, 17), frame.slice(17)]).flat()
  } else {
    input = frames
  }
  const transform = converter(requested)
  let text = ''
  transform.on('data', chunk => { text += chunk.toString('utf8') })
  Readable.from(input).pipe(transform)
  await once(transform, 'end')
  const events = []
  for (const frame of text.split('\n\n')) {
    if (!frame) continue
    const match = /^event: ([^\n]+)\ndata: (.+)$/s.exec(frame)
    assert.ok(match, `complete Anthropic event frame: ${frame}`)
    events.push({ event: match[1], ...JSON.parse(match[2]) })
  }
  return events
}

const kinds = events => events.map(event => event.type)
const messageDelta = events => events.find(event => event.type === 'message_delta')
const jsonArguments = (events, index) => events
  .filter(event => event.index === index && event.delta?.type === 'input_json_delta')
  .map(event => event.delta.partial_json).join('')

// Source contract: morph-openai-wire.test.mjs, case 1. HTTP status, hit count,
// upstream path, model routing and authentication remain proxy responsibilities.
test('case1 request translation', () => {
  const out = anthropicToOpenAIChat({
    model: MODEL,
    max_tokens: 900,
    temperature: 0.2,
    system: [{ type: 'text', text: 'You are terse.' }],
    thinking: { type: 'enabled', budget_tokens: 16000 },
    tools: [{
      name: 'get_weather',
      description: 'Weather for a city',
      input_schema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city']
      }
    }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Weather in Paris?', cache_control: { type: 'ephemeral' } }] },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'prior turn reasoning', signature: 'sig' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '18C, rain' }] },
        { type: 'text', text: 'Summarize.' }
      ] }
    ]
  })

  assert.equal(out.reasoning_effort, 'high', 'case1 reasoning_effort high from budget 16000')
  assert.deepEqual(out.messages[0], { role: 'system', content: 'You are terse.' }, 'case1 system message first')
  assert.ok(out.messages.some(message => message.role === 'tool' && message.tool_call_id === 'toolu_1' && message.content === '18C, rain'), 'case1 tool_result became role tool')
  assert.ok(out.messages.some(message => message.role === 'assistant' &&
    message.tool_calls?.[0]?.id === 'toolu_1' &&
    message.tool_calls[0]?.function?.name === 'get_weather' &&
    message.tool_calls[0]?.function?.arguments === '{"city":"Paris"}'), 'case1 assistant tool_use became tool_calls')
  assert.ok(!JSON.stringify(out).includes('prior turn reasoning'), 'case1 prior thinking dropped')
  assert.ok(!JSON.stringify(out).includes('cache_control'), 'case1 cache_control dropped')
  assert.equal(out.tools[0].type, 'function', 'case1 tools translated')
  assert.equal(out.tools[0].function.name, 'get_weather')
  assert.deepEqual(out.tools[0].function.parameters.required, ['city'])
  assert.equal(out.max_tokens, 900, 'case1 max_tokens carried')
  assert.equal(out.temperature, 0.2, 'case1 temperature carried')
  assert.equal(out.stream, true, 'case1 streaming fidelity')
  assert.deepEqual(out.stream_options, { include_usage: true }, 'case1 stream_options include_usage')
})

test('case2 budget to effort mapping', async t => {
  const cases = [[512, 'minimal'], [2048, 'low'], [8192, 'medium'], [16384, 'high'], [32768, 'xhigh'], [40000, 'max']]
  for (const [budget, effort] of cases) {
    await t.test(`budget ${budget} -> ${effort}`, () => {
      assert.equal(request({ thinking: { type: 'enabled', budget_tokens: budget } }).reasoning_effort, effort)
    })
  }
  await t.test('no thinking block omits reasoning_effort', () => {
    assert.equal(Object.hasOwn(request(), 'reasoning_effort'), false)
  })
  await t.test('stream:false client stays non-stream upstream', () => {
    const out = request({ stream: false })
    assert.equal(out.stream, false)
    assert.equal(Object.hasOwn(out, 'stream_options'), false)
  })
})

test('case3 stream translation', async () => {
  const events = await collectStream([
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Think ' }, finish_reason: null }] },
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: { reasoning_content: 'twice.' }, finish_reason: null }] },
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'Hello ' }, finish_reason: null }] },
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'there.' }, finish_reason: null }] },
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { id: 'chatcmpl-1', choices: [], usage: { prompt_tokens: 96, completion_tokens: 48, prompt_tokens_details: { cached_tokens: 7 } } }
  ], { split: true })

  assert.equal(events[0].type, 'message_start', 'case3 starts with message_start')
  assert.equal(events[0].message.model, MODEL, 'case3 message_start names the mux id')
  assert.match(events[0].message.id, /^msg_1$/, 'case3 message id is msg_ shaped and chatcmpl stripped')
  assert.equal(kinds(events).at(-1), 'message_stop', 'case3 event order ends message_stop')
  const thinking = events.filter(event => event.delta?.type === 'thinking_delta').map(event => event.delta.thinking).join('')
  assert.equal(thinking, 'Think twice.', 'case3 thinking deltas joined')
  const text = events.filter(event => event.delta?.type === 'text_delta').map(event => event.delta.text).join('')
  assert.equal(text, 'Hello there.', 'case3 text deltas joined')
  const starts = events.filter(event => event.type === 'content_block_start')
  assert.deepEqual(starts.map(event => [event.index, event.content_block.type]), [[0, 'thinking'], [1, 'text']], 'case3 thinking block opens before text block')
  const md = messageDelta(events)
  assert.equal(md.delta.stop_reason, 'end_turn', 'case3 stop end_turn')
  assert.equal(md.usage.input_tokens, 96, 'case3 input usage mapped')
  assert.equal(md.usage.output_tokens, 48, 'case3 output usage mapped')
  assert.equal(md.usage.cache_read_input_tokens, 7, 'case3 cached usage mapped')
  assert.equal(events.filter(event => event.type === 'message_delta').length, 1, 'case3 one final message_delta')
  assert.ok(!JSON.stringify(events).includes('"choices"') && !JSON.stringify(events).includes('chatcmpl'), 'case3 no openai shapes leak')
  assert.equal(events.filter(event => event.type === 'content_block_stop').length, 2, 'case3 content_block_stop count matches starts')
})

test('case4 tool-call stream and finish', async () => {
  const events = await collectStream([
    { id: 'chatcmpl-2', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Call it.' }, finish_reason: null }] },
    { id: 'chatcmpl-2', choices: [{ index: 0, delta: { content: null, tool_calls: [{ index: 0, id: 'call-abc', type: 'function', function: { name: 'get_weather', arguments: '{"ci' } }] }, finish_reason: null }] },
    { id: 'chatcmpl-2', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"Paris"}' } }] }, finish_reason: null }] },
    { id: 'chatcmpl-2', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { id: 'chatcmpl-2', choices: [], usage: { prompt_tokens: 178, completion_tokens: 75, prompt_tokens_details: { cached_tokens: 0 } } }
  ])
  const toolStart = events.find(event => event.type === 'content_block_start' && event.content_block?.type === 'tool_use')
  assert.equal(toolStart.content_block.id, 'call-abc', 'case4 tool_use block carries id')
  assert.equal(toolStart.content_block.name, 'get_weather', 'case4 tool_use block carries name')
  assert.equal(jsonArguments(events, toolStart.index), '{"city":"Paris"}', 'case4 fragmented arguments reassembled')
  assert.equal(messageDelta(events).delta.stop_reason, 'tool_use', 'case4 stop_reason tool_use')
  assert.equal(messageDelta(events).usage.cache_read_input_tokens, undefined, 'case4 zero cached tokens omitted')
  assert.equal(kinds(events).at(-1), 'message_stop', 'case4 message closes')
})

// Source case 5 only verifies provider routing. It is outside this package.
// Preserve its unflagged Anthropic request fixture here as a translation input.
test('case5 unflagged fixture remains independently translatable', () => {
  const out = request({ stream: false, system: 'sys', model: 'anthropic-morph-dsv41flash' })
  assert.equal(out.stream, false)
  assert.equal(out.model, 'anthropic-morph-dsv41flash')
  assert.deepEqual(out.messages[0], { role: 'system', content: 'sys' })
})

test('case6 unsupported block type throws before returning a request', () => {
  assert.throws(() => request({
    messages: [{ role: 'user', content: [{ type: 'document', source: { media_type: 'text/plain' } }] }]
  }), error => {
    assert.ok(error instanceof UnsupportedContentError)
    assert.equal(error.blockType, 'document', 'case6 refusal names the block type')
    assert.match(error.message, /document/)
    return true
  })
})

test('case7 upstream cut without [DONE] still closes', async () => {
  const events = await collectStream([
    { id: 'chatcmpl-3', choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }] }
  ], { done: false })
  assert.equal(messageDelta(events).delta.stop_reason, 'end_turn', 'case7 cut stream still emits message_delta')
  assert.equal(kinds(events).at(-1), 'message_stop', 'case7 cut stream still emits message_stop')
  assert.equal(events.filter(event => event.type === 'content_block_stop').length, 1)
})

test('new two tools with different indexes and interleaved fragments', async () => {
  const events = await collectStream([
    { id: 'chatcmpl-tools', choices: [{ index: 0, delta: { tool_calls: [{ index: 4, id: 'call-a', function: { name: 'first', arguments: '{"a":' } }] } }] },
    { id: 'chatcmpl-tools', choices: [{ index: 0, delta: { tool_calls: [{ index: 9, id: 'call-b', function: { name: 'second', arguments: '{"b":' } }] } }] },
    { id: 'chatcmpl-tools', choices: [{ index: 0, delta: { tool_calls: [{ index: 4, function: { arguments: '1}' } }] } }] },
    { id: 'chatcmpl-tools', choices: [{ index: 0, delta: { tool_calls: [{ index: 9, function: { arguments: '2}' } }] } }] },
    { id: 'chatcmpl-tools', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
  ])
  const tools = events.filter(event => event.type === 'content_block_start' && event.content_block.type === 'tool_use')
  assert.deepEqual(tools.map(event => [event.index, event.content_block.id, event.content_block.name]), [
    [0, 'call-a', 'first'],
    [1, 'call-b', 'second']
  ], 'OpenAI indexes create separate tool blocks')
  assert.equal(jsonArguments(events, 0), '{"a":1}', 'first tool interleaved arguments stay together')
  assert.equal(jsonArguments(events, 1), '{"b":2}', 'second tool interleaved arguments stay together')
  assert.equal(events.filter(event => event.type === 'input_json_delta').length, 0)
  assert.equal(messageDelta(events).delta.stop_reason, 'tool_use')
  assert.equal(kinds(events).at(-1), 'message_stop')
})

test('new image part and multi-block user message', () => {
  const out = request({
    messages: [
      { role: 'user', content: [
        { type: 'text', text: 'Describe this image.' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
        { type: 'text', text: 'Name the dominant color.' }
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'toolu_empty', content: [] },
        { type: 'text', text: 'Continue.' }
      ] }
    ]
  })
  assert.deepEqual(out.messages[0], {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this image.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
      { type: 'text', text: 'Name the dominant color.' }
    ]
  })
  assert.deepEqual(out.messages[1], { role: 'tool', tool_call_id: 'toolu_empty', content: '(empty tool result)' })
  assert.deepEqual(out.messages[2], { role: 'user', content: 'Continue.' })
})

test('new non-stream response with reasoning text and tool_calls together', () => {
  const message = openaiToAnthropicJson({
    id: 'chatcmpl-response_abc-123',
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        reasoning_content: 'Check then call.',
        content: 'I will check.',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"query":"answer"}' } }]
      }
    }],
    usage: { prompt_tokens: 25, completion_tokens: 13, prompt_tokens_details: { cached_tokens: 5 } }
  }, MODEL)
  assert.deepEqual(message.content, [
    { type: 'thinking', thinking: 'Check then call.' },
    { type: 'text', text: 'I will check.' },
    { type: 'tool_use', id: 'call-1', name: 'lookup', input: { query: 'answer' } }
  ])
  assert.equal(message.stop_reason, 'tool_use')
  assert.equal(message.model, MODEL)
  assert.equal(message.id, 'msg_responseabc123')
  assert.deepEqual(message.usage, { input_tokens: 25, output_tokens: 13, cache_read_input_tokens: 5 })
})

test('whole frames and split UTF-8 preserve every delta', async () => {
  for (const split of [false, true]) {
    const events = await collectStream([
      { id: 'chatcmpl-unicode', choices: [{ delta: { content: 'CAFÉ 你好.' }, finish_reason: null }] },
      { id: 'chatcmpl-unicode', choices: [{ delta: { content: ' Next.' }, finish_reason: 'stop' }] },
      { id: 'chatcmpl-unicode', choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }
    ], { split })
    assert.equal(events.filter(e => e.delta?.type === 'text_delta').map(e => e.delta.text).join(''), 'CAFÉ 你好. Next.')
  }
})

test('content-only fast paths preserve null-field transitions and escaping', async () => {
  const chunks = [
    { id: 'chatcmpl-fields', choices: [{ delta: { content: null, reasoning_content: 'think' }, finish_reason: null }] },
    { id: 'chatcmpl-fields', choices: [{ delta: { content: 'text \"\\' }, finish_reason: 'stop' }] }
  ]
  for (const split of [false, true]) {
    const before = await collectStream(chunks, { split, converter: baselineStream })
    const after = await collectStream(chunks, { split })
    assert.deepEqual(after, before)
  }
})

test('incremental SSE syntax stays byte-identical to the baseline', async () => {
  const chunks = [
    { id: 'chatcmpl-crlf', choices: [{ delta: { reasoning_content: 'think', content: 'text' }, finish_reason: null }] },
    { id: 'chatcmpl-crlf', choices: [{ delta: { tool_calls: [{ index: 1, id: 'a', function: { name: 't', arguments: '{"x":' } }] }, finish_reason: null, finish_reason: null }] },
    { id: 'chatcmpl-crlf', choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'true}' } }] }, finish_reason: 'tool_calls' }] },
    { id: 'chatcmpl-crlf', choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } }
  ]
  for (const converter of [baselineStream, openaiToAnthropicStream]) {
    const frames = chunks.map(chunk => `event: message\r\nid: 1\r\ndata:\t${JSON.stringify(chunk)}\t\r\n\r\n`).join('') +
      'data:\r\n\r\nnot-data\r\n\r\ndata: {invalid}\r\n\r\ndata: [DONE]\r\n\r\n'
    const input = [frames.slice(0, 11), frames.slice(11, 55), frames.slice(55)]
    const stream = converter(MODEL)
    let text = ''
    stream.on('data', chunk => { text += chunk.toString('utf8') })
    Readable.from(input).pipe(stream)
    await once(stream, 'end')
    const events = []
    for (const frame of text.split('\n\n')) {
      if (!frame) continue
      const match = /^event: ([^\n]+)\ndata: (.+)$/s.exec(frame)
      assert.ok(match, frame)
      events.push(JSON.parse(match[2]))
    }
    if (converter === baselineStream) var baselineEvents = events
    else assert.deepEqual(events, baselineEvents)
  }
})

test('new effort table boundary values 512 2048 8192 16384 32768 32769', async t => {
  const cases = [
    [512, 'minimal'], [2048, 'low'], [8192, 'medium'],
    [16384, 'high'], [32768, 'xhigh'], [32769, 'max']
  ]
  for (const [budget_tokens, expected] of cases) {
    await t.test(`boundary ${budget_tokens} -> ${expected}`, () => {
      assert.equal(morphEffortFromThinking({ thinking: { type: 'enabled', budget_tokens } }), expected)
    })
  }
})
