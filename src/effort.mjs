export function morphEffortFromThinking (body) {
  const t = body?.thinking
  if (!t || t.type !== 'enabled' || !Number.isFinite(t.budget_tokens)) return null
  const b = t.budget_tokens
  if (b <= 512) return 'minimal'
  if (b <= 2048) return 'low'
  if (b <= 8192) return 'medium'
  if (b <= 16384) return 'high'
  if (b <= 32768) return 'xhigh'
  return 'max'
}
