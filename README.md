# anthropic-openai-translator

This package translates Anthropic Messages requests to OpenAI Chat Completions.
It also translates OpenAI JSON responses and SSE streams to Anthropic formats.
The package has zero runtime dependencies. It requires Node.js 18 or later.
The package uses ESM only. It contains no network or filesystem access.

## API

```js
import {
  anthropicToOpenAIChat,
  openaiToAnthropicJson,
  openaiToAnthropicStream,
  morphEffortFromThinking,
  UnsupportedContentError
} from 'anthropic-openai-translator'

const openaiRequest = anthropicToOpenAIChat(anthropicRequest)
const anthropicMessage = openaiToAnthropicJson(openaiResponse, requestedModel)
const stream = openaiToAnthropicStream(requestedModel)
```

`morphEffortFromThinking` maps an Anthropic thinking budget to `reasoning_effort`.
Unsupported user content throws `UnsupportedContentError`. The error carries `blockType`.
Assistant history drops thinking blocks and `cache_control`.

`openaiToAnthropicStream` returns a Node.js `Transform`. Pipe OpenAI SSE bytes through the transform.
The transform emits complete Anthropic SSE event frames. It closes a truncated stream cleanly.
The caller owns transport, authentication, upstream errors, and provider routing.

## Test

Run `node --test test/translate.test.mjs` from this directory.
