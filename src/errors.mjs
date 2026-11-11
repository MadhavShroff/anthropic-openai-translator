export class UnsupportedContentError extends Error {
  constructor (blockType) {
    super(`the OpenAI chat wire cannot carry content block "${blockType}"`)
    this.name = 'UnsupportedContentError'
    this.blockType = blockType
  }
}

export function flattenAnthropicText (content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter(b => b?.type === 'text').map(b => b.text || '').join('\n')
  }
  return ''
}
