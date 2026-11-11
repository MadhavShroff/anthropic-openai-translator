import { Transform } from 'node:stream'
import { stopReasonFromFinish } from './response.mjs'

export function openaiToAnthropicStream (requested) {
  let started = false
  let finished = false
  let nextIndex = 0
  let openBlock = null
  let stopReason = 'end_turn'
  let usage = null
  const tools = []
  let out
  let tail = ''

  const closeOpen = () => {
    if (openBlock == null) return
    out(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${nextIndex - 1}}\n\n`)
    openBlock = null
  }
  const openBlockAs = (kind, extra) => {
    if (openBlock === kind) return
    closeOpen()
    out(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: nextIndex, content_block: { type: kind, ...extra } })}\n\n`)
    nextIndex++
    openBlock = kind
  }

  const handleChunk = (d) => {
    if (!started) {
      started = true
      const id = 'msg_' + String(d.id || '').replace(/^chatcmpl-?/i, '').replace(/[^a-zA-Z0-9]/g, '').slice(-24)
      out(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: requested, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`)
    }
    const ch = (d.choices || [])[0]
    if (!ch) {
      if (d.usage) usage = d.usage
      return
    }
    const delta = ch.delta || {}
    if (openBlock === 'text' && typeof delta.content === 'string' && delta.content && delta.reasoning_content === undefined && delta.tool_calls === undefined) {
      out(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(delta.content)}}}\n\n`)
      if (ch.finish_reason) stopReason = stopReasonFromFinish(ch.finish_reason)
      return
    }
    if (openBlock === 'thinking' && typeof delta.reasoning_content === 'string' && delta.reasoning_content && delta.content === undefined && delta.tool_calls === undefined) {
      out(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":${JSON.stringify(delta.reasoning_content)}}}\n\n`)
      if (ch.finish_reason) stopReason = stopReasonFromFinish(ch.finish_reason)
      return
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      openBlockAs('thinking', { thinking: '' })
      out(`event: content_block_delta\ndata: {"type":"content_block_delta","index":${nextIndex - 1},"delta":{"type":"thinking_delta","thinking":${JSON.stringify(delta.reasoning_content)}}}\n\n`)
    }
    if (typeof delta.content === 'string' && delta.content) {
      openBlockAs('text', { text: '' })
      out(`event: content_block_delta\ndata: {"type":"content_block_delta","index":${nextIndex - 1},"delta":{"type":"text_delta","text":${JSON.stringify(delta.content)}}}\n\n`)
    }
    const calls = delta.tool_calls
    if (calls?.length === 1 && calls[0].index === 0 && calls[0].id === undefined &&
        typeof calls[0].function?.arguments === 'string' && calls[0].function.arguments &&
        tools.length === 1 && tools[0].index === 0 &&
        delta.reasoning_content === undefined && delta.content === undefined) {
      out(`event: content_block_delta\ndata: {"type":"content_block_delta","index":${tools[0].blockIndex},"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(calls[0].function.arguments)}}}\n\n`)
      if (ch.finish_reason) stopReason = stopReasonFromFinish(ch.finish_reason)
      return
    }
    for (const f of calls || []) {
      let tool = tools.find(t => t.index === f.index)
      if (f.id && !tool) {
        closeOpen()
        const blockIndex = nextIndex
        tool = { index: f.index, blockIndex, id: f.id, name: f.function?.name || '' }
        tools.push(tool)
        out(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: f.id, name: tool.name, input: {} } })}\n\n`)
        nextIndex++
        openBlock = 'tool'
      }
      if (tool && typeof f.function?.arguments === 'string' && f.function.arguments) {
        out(`event: content_block_delta\ndata: {"type":"content_block_delta","index":${tool.blockIndex},"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(f.function.arguments)}}}\n\n`)
      }
    }
    if (ch.finish_reason) stopReason = stopReasonFromFinish(ch.finish_reason)
  }

  const finish = (push) => {
    if (!started || finished) return
    finished = true
    closeOpen()
    const u = {
      output_tokens: usage?.completion_tokens ?? 0,
      input_tokens: usage?.prompt_tokens ?? 0,
      ...(usage?.prompt_tokens_details?.cached_tokens ? { cache_read_input_tokens: usage.prompt_tokens_details.cached_tokens } : {})
    }
    push(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: u })}\n\n`)
    push('event: message_stop\ndata: {"type":"message_stop"}\n\n')
  }

  const stream = new Transform({
    transform (chunk, _enc, cb) {
      try {
        const frame = tail + chunk.toString('utf8')
        if (!tail.length && frame.length > 8 && frame.startsWith('data: ') && frame.endsWith('\n\n') && frame.indexOf('\n', 6) === frame.length - 2) {
          const payload = frame.slice(6, -2)
          if (payload === '[DONE]') {
            finish((c) => this.push(c))
          } else {
            let d
            try { d = JSON.parse(payload) } catch { d = null }
            if (d) handleChunk(d)
          }
          cb()
          return
        }
        tail = frame
        let idx
        while ((idx = tail.indexOf('\n')) >= 0) {
          const line = tail.slice(0, idx)
          tail = tail.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') { finish((c) => this.push(c)); break }
          if (!payload) continue
          let d
          try { d = JSON.parse(payload) } catch { continue }
          handleChunk(d)
        }
        cb()
      } catch (e) {
        cb(e)
      }
    },
    flush (cb) {
      finish((c) => this.push(c))
      cb()
    }
  })
  out = stream.push.bind(stream)
  return stream
}
