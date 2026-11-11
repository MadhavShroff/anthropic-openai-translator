export function openaiToAnthropicJson (parsed, requested) {
  const ch = (parsed.choices || [])[0] || {}
  const msg = ch.message || {}
  const usage = parsed.usage || {}
  const content = []
  if (msg.reasoning || msg.reasoning_content) {
    content.push({ type: 'thinking', thinking: msg.reasoning || msg.reasoning_content })
  }
  if (msg.content) content.push({ type: 'text', text: msg.content })
  for (const tc of msg.tool_calls || []) {
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function?.name || '',
      input: JSON.parse(tc.function?.arguments || '{}')
    })
  }
  const stop = ch.finish_reason === 'tool_calls'
    ? 'tool_use'
    : ch.finish_reason === 'length' ? 'max_tokens' : 'end_turn'
  return {
    id: 'msg_' + String(parsed.id || '').replace(/^chatcmpl-?/i, '').replace(/[^a-zA-Z0-9]/g, '').slice(-24),
    type: 'message',
    role: 'assistant',
    model: requested,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      cache_read_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0
    }
  }
}

export function stopReasonFromFinish (finishReason) {
  if (finishReason === 'tool_calls') return 'tool_use'
  if (finishReason === 'length') return 'max_tokens'
  return 'end_turn'
}
