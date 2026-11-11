# anthropic-openai-translator

Translate Anthropic Messages requests into OpenAI Chat Completions requests, and translate OpenAI JSON responses and SSE streams back into Anthropic formats.

## Install

```bash
npm install anthropic-openai-translator
```

The package requires Node.js 18 or later. It is ESM only. It has zero runtime dependencies and performs no network or filesystem access.

## Usage

```js
import {
  anthropicToOpenAIChat,
  openaiToAnthropicJson,
  openaiToAnthropicStream
} from 'anthropic-openai-translator'

// Anthropic Messages request -> OpenAI Chat Completions request body
const openaiRequest = anthropicToOpenAIChat(anthropicRequest)

// Parsed OpenAI JSON response -> Anthropic message object
const anthropicMessage = openaiToAnthropicJson(openaiResponse, anthropicRequest.model)

// OpenAI SSE bytes -> Anthropic SSE event frames
const translate = openaiToAnthropicStream(anthropicRequest.model)
```

## API

### `anthropicToOpenAIChat(anthropicRequest)`

Returns an OpenAI Chat Completions request body.

- `system` becomes a leading `system` message.
- `text` blocks become text content.
- Base64 `image` blocks become `image_url` parts.
- `tool_result` blocks become `tool` messages.
- Assistant `tool_use` blocks become `tool_calls`.
- `tools` become function definitions.
- `tool_choice` becomes `auto`, `required`, or a named function.
- `thinking.budget_tokens` becomes `reasoning_effort`.
- `max_tokens`, `temperature`, `top_p` and `stop_sequences` pass through.

The output sets `stream: true` unless `anthropicRequest.stream === false`. A streaming request also sets `stream_options: { include_usage: true }`. Assistant history keeps text and `tool_use`; the function drops thinking blocks and `cache_control`.

### `openaiToAnthropicJson(openaiResponse, requestedModel)`

Takes a parsed OpenAI chat completion and returns an Anthropic message object.

- `reasoning` or `reasoning_content` becomes a `thinking` block.
- `content` becomes a `text` block.
- `tool_calls` become `tool_use` blocks; the arguments string is parsed as JSON.
- `usage` maps to `input_tokens`, `output_tokens` and `cache_read_input_tokens`.
- `finish_reason` maps to `stop_reason`: `tool_calls` becomes `tool_use`, `length` becomes `max_tokens`, anything else becomes `end_turn`.
- The result carries `requestedModel` as its `model`.

### `openaiToAnthropicStream(requestedModel)`

Returns a Node.js `Transform`. Write OpenAI SSE bytes to it. It pushes complete Anthropic SSE event frames as string chunks.

```js
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { openaiToAnthropicStream } from 'anthropic-openai-translator'

// openaiRequest came from anthropicToOpenAIChat(anthropicRequest).
const response = await fetch(openaiEndpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify(openaiRequest)
})

// httpResponse is a Node.js http.ServerResponse.
await pipeline(
  Readable.fromWeb(response.body),
  openaiToAnthropicStream(anthropicRequest.model),
  httpResponse
)
```

The transform parses `data:` lines and `[DONE]`, emits `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta` and `message_stop`, maps `delta.reasoning_content` to a thinking block, maps streamed `tool_calls` fragments to `tool_use` blocks with `input_json_delta`, and reports usage from the final usage chunk. A stream that ends without `[DONE]` still emits the closing events. The caller owns transport, authentication, upstream HTTP errors and provider routing.

## Errors

- `anthropicToOpenAIChat` throws `UnsupportedContentError` when a user content block has a type the OpenAI chat wire cannot carry. The error carries `blockType`, the offending block type.
- `openaiToAnthropicJson` throws when a `tool_calls` arguments string is not valid JSON.
- The stream transform skips a `data:` line that does not parse as JSON. Any other error propagates.

The package also exports helpers: `morphEffortFromThinking(body)` maps a thinking budget to `reasoning_effort` or returns `null`; `stopReasonFromFinish(finishReason)` maps a finish reason to a stop reason; `flattenAnthropicText(content)` joins the text blocks of a content array into one string.

## Benchmarks

Median wall time against LiteLLM 1.74.9, run 2026-11-10. Lower is better. Selected rows only; see [BENCHMARKS.md](BENCHMARKS.md) for the method, all 15 cases and the limits.

| Operation | Size | This package ms | LiteLLM ms | Ratio |
| --- | --- | ---: | ---: | ---: |
| anthropic_to_openai_json | 1k | 0.002624 | 0.008368 | 3.19x |
| openai_to_anthropic_json | 1k | 0.000656 | 0.027568 | 42.02x |
| openai_to_anthropic_stream_1000 | 1k | 1.135687 | 35.767401 | 31.49x |
| anthropic_to_openai_json | 1M | 0.095552 | 0.709132 | 7.42x |
| openai_to_anthropic_json | 1M | 0.000608 | 0.027440 | 45.13x |
| openai_to_anthropic_stream_1000 | 1M | 4.942170 | 52.539701 | 10.63x |

This package had the lower median in all 15 paired cases. The LiteLLM median was 3.19x to 45.37x the median of this package. The comparison crosses JavaScript and Python runtimes, so the ratios include runtime cost, not translation cost alone.

## Test

```bash
node --test
```

## License

[MIT](LICENSE)

Find this project useful? Consider starring it.
