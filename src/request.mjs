import { UnsupportedContentError, flattenAnthropicText } from './errors.mjs'
import { morphEffortFromThinking } from './effort.mjs'

export function anthropicToOpenAIChat (body) {
  const out = { model: body.model, stream: body.stream !== false, messages: [] }
  if (body.system != null) {
    const sys = flattenAnthropicText(body.system)
    if (sys) out.messages.push({ role: 'system', content: sys })
  }
  for (const m of body.messages || []) {
    const blocks = Array.isArray(m.content)
      ? m.content
      : [{ type: 'text', text: String(m.content ?? '') }]
    if (m.role === 'assistant') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('\n')
      const toolUses = blocks.filter(b => b.type === 'tool_use')
      const msg = { role: 'assistant', content: text || null }
      if (toolUses.length) {
        msg.tool_calls = toolUses.map(t => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) }
        }))
      }
      out.messages.push(msg)
    } else {
      const parts = []
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          out.messages.push({
            role: 'tool',
            tool_call_id: b.tool_use_id,
            content: flattenAnthropicText(b.content) || '(empty tool result)'
          })
        } else if (b.type === 'text') {
          parts.push({ type: 'text', text: b.text || '' })
        } else if (b.type === 'image' && b.source?.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` }
          })
        } else {
          throw new UnsupportedContentError(b.type)
        }
      }
      if (parts.length) {
        out.messages.push({
          role: 'user',
          content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts
        })
      }
    }
  }
  if (Number.isFinite(body.max_tokens)) out.max_tokens = body.max_tokens
  if (Number.isFinite(body.temperature)) out.temperature = body.temperature
  if (Number.isFinite(body.top_p)) out.top_p = body.top_p
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) out.stop = body.stop_sequences
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} }
      }
    }))
  }
  const tc = body.tool_choice?.type
  if (tc === 'auto') out.tool_choice = 'auto'
  else if (tc === 'any') out.tool_choice = 'required'
  else if (tc === 'tool') out.tool_choice = { type: 'function', function: { name: body.tool_choice.name } }
  const effort = morphEffortFromThinking(body)
  if (effort) out.reasoning_effort = effort
  if (out.stream) out.stream_options = { include_usage: true }
  return out
}
