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
  const buf = []
  let tail = ''
  const out = (chunk) => buf.push(chunk)
  const flush = () => { const b = buf.splice(0); return b.length ? b : null }

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
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      openBlockAs('thinking', { thinking: '' })
      out(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: nextIndex - 1, delta: { type: 'thinking_delta', thinking: delta.reasoning_content } })}\n\n`)
    }
    if (typeof delta.content === 'string' && delta.content) {
      openBlockAs('text', { text: '' })
      out(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: nextIndex - 1, delta: { type: 'text_delta', text: delta.content } })}\n\n`)
    }
    for (const f of delta.tool_calls || []) {
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
        out(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: tool.blockIndex, delta: { type: 'input_json_delta', partial_json: f.function.arguments } })}\n\n`)
      }
    }
    if (ch.finish_reason) stopReason = stopReasonFromFinish(ch.finish_reason)
  }

  const finish = (push) => {
    if (!started || finished) return
    finished = true
    closeOpen()
    const pending = flush()
    if (pending) for (const c of pending) push(c)
    const u = {
      output_tokens: usage?.completion_tokens ?? 0,
      input_tokens: usage?.prompt_tokens ?? 0,
      ...(usage?.prompt_tokens_details?.cached_tokens ? { cache_read_input_tokens: usage.prompt_tokens_details.cached_tokens } : {})
    }
    push(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: u })}\n\n`)
    push('event: message_stop\ndata: {"type":"message_stop"}\n\n')
  }

  return new Transform({
    transform (chunk, _enc, cb) {
      try {
        tail += chunk.toString('utf8')
        let idx
        while ((idx = tail.indexOf('\n')) >= 0) {
          const line = tail.slice(0, idx).replace(/\r$/, '')
          tail = tail.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') { finish((c) => out(c)); break }
          if (!payload) continue
          let d
          try { d = JSON.parse(payload) } catch { continue }
          handleChunk(d)
        }
        const b = flush()
        if (b) for (const c of b) this.push(c)
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
}
