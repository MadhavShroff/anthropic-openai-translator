import { performance } from 'node:perf_hooks'
import { anthropicToOpenAIChat, openaiToAnthropicJson, openaiToAnthropicStream } from '../src/index.mjs'

const MODEL = 'anthropic-morph-kimik31'
const SIZES = { '1k': 4000, '100k': 400000, '1M': 4000000 }
const TYPES = ['mixed', 'text', 'thinking', 'tools']
const CHUNKS = [100, 1000, 10000]
const iterations = 200
const warmups = 50

function times (values) {
  values.sort((a, b) => a - b)
  return { medianMs: values[Math.floor((values.length - 1) / 2)], p95Ms: values[Math.ceil(0.95 * values.length) - 1] }
}

async function measure (fn) {
  for (let i = 0; i < warmups; i++) await fn()
  const samples = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    const result = await fn()
    samples.push(performance.now() - start)
    if (result == null || result === 0) throw new Error('Empty translation result')
  }
  return times(samples)
}

function repeatedText (target, seed) {
  return seed.repeat(Math.ceil(target / seed.length)).slice(0, target)
}

function makeFixture (size) {
  const target = SIZES[size]
  const text = repeatedText(target, 'Translation payload: café 你好.\n')
  const body = {
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.2,
    system: 'Be accurate.',
    tools: [{ name: 'lookup', description: 'Find text', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }],
    messages: [{ role: 'user', content: text }, {
      role: 'assistant',
      content: [{ type: 'text', text }, { type: 'tool_use', id: 'call-a', name: 'lookup', input: { query: text } }]
    }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-a', content: text }] }]
  }
  const parsed = {
    id: 'chatcmpl-fixture',
    choices: [{ finish_reason: 'tool_calls', message: {
      reasoning_content: text,
      content: text,
      tool_calls: [{ id: 'call-a', function: { name: 'lookup', arguments: JSON.stringify({ query: text }) } }]
    } }],
    usage: { prompt_tokens: 100, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 20 } }
  }
  return { body, parsed }
}

function makeStream (size, type, count) {
  const target = SIZES[size]
  const text = repeatedText(target, 'Stream payload: café 你好.\n')
  const perChunk = Math.ceil(text.length / count)
  const frames = [{ id: 'chatcmpl-stream', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }]
  for (let i = 0; i < count; i++) {
    const part = text.slice(i * perChunk, (i + 1) * perChunk)
    let delta
    if (type === 'text') delta = { content: part }
    else if (type === 'thinking') delta = { reasoning_content: part }
    else if (type === 'tools') delta = { tool_calls: [{ index: 0, ...(i === 0 ? { id: 'call-a', function: { name: 'lookup' } } : {}), function: { arguments: part } }] }
    else {
      delta = i % 3 === 0 ? { reasoning_content: part } : i % 3 === 1 ? { content: part } : { tool_calls: [{ index: 0, ...(i < 3 ? { id: 'call-a', function: { name: 'lookup' } } : {}), function: { arguments: part } }] }
    }
    frames.push({ id: 'chatcmpl-stream', choices: [{ delta, finish_reason: i === count - 1 ? (type === 'text' || type === 'thinking' ? 'stop' : 'tool_calls') : null }] })
  }
  frames.push({ id: 'chatcmpl-stream', choices: [], usage: { prompt_tokens: 100, completion_tokens: 80 } })
  frames.push('[DONE]')
  const encoded = frames.map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`).join('')
  const input = Buffer.from(encoded)
  const chunks = []
  // Divide the encoded input to exercise the incremental UTF-8 decoder.
  const perBuffer = Math.ceil(input.length / (count + 2))
  for (let offset = 0; offset < input.length; offset += perBuffer) chunks.push(input.subarray(offset, offset + perBuffer))
  return { chunks, bytes: input.length }
}

function consume (chunks) {
  return new Promise((resolve, reject) => {
    const stream = openaiToAnthropicStream(MODEL)
    let length = 0
    stream.on('data', chunk => { length += chunk.length })
    stream.once('error', reject)
    stream.once('end', () => resolve(length))
    for (const chunk of chunks) stream.write(chunk)
    stream.end()
  })
}

const results = []
for (const size of Object.keys(SIZES)) {
  const { body, parsed } = makeFixture(size)
  if (deepEqualSafe(anthropicToOpenAIChat(body)) == null) throw new Error('Invalid request fixture')
  results.push({ operation: 'anthropic_to_openai_json', size, ...await measure(() => anthropicToOpenAIChat(body)) })
  results.push({ operation: 'openai_to_anthropic_json', size, ...await measure(() => openaiToAnthropicJson(parsed, MODEL)) })
  for (const type of TYPES) {
    const count = CHUNKS[Object.keys(SIZES).indexOf(size)]
    const { chunks, bytes } = makeStream(size, type, count)
    results.push({ operation: `openai_to_anthropic_stream_${type}_${count}`, size, bytes, ...await measure(() => consume(chunks)) })
  }
  const row = results.at(-1)
  console.error(`${size}: ${results.length}/${Object.keys(SIZES).length * 6} cases; last median ${row.medianMs.toFixed(3)} ms`)
}

function deepEqualSafe (value) { return JSON.stringify(value) }
const result = { runtime: process.version, platform: `${process.platform}/${process.arch}`, iterations, warmups, argv: process.argv.slice(1), results }
if (process.env.BENCH_FORMAT === 'json') console.log(JSON.stringify(result, null, 2))
else {
  console.log('| Operation | Size | Median ms | p95 ms |')
  console.log('| --- | --- | ---: | ---: |')
  for (const row of results) console.log(`| ${row.operation} | ${row.size} | ${row.medianMs.toFixed(6)} | ${row.p95Ms.toFixed(6)} |`)
}
