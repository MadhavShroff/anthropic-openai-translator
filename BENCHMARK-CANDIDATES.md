# Benchmark candidates

Research date: 2026-11-11.

These projects expose in-process translation callables and are the fairest
next comparators. Each row names the project, the supported direction, and
the reason it is a good comparator.

| Candidate | Direction | Why it is a fair comparator |
| --- | --- | --- |
| [@zenmux/rosetta-ai](https://github.com/ZenMux/rosetta-ai) | Anthropic ↔ OpenAI, request, response, stream | First-class converter classes with one method shape per leg; the closest like-for-like competitor. |
| [llm-bridge](https://github.com/supermemoryai/llm-bridge) | Anthropic ↔ OpenAI through a universal format | Bidirectional, streaming, zero runtime dependencies; same architecture class as most designs. |
| [@openrouter/agent](https://github.com/OpenRouterTeam/typescript-agent) | Anthropic ↔ OpenAI through OpenResponses | Official OpenRouter package with a small dependency set and documented lossiness, which gives a free fidelity datapoint. |

No in-process translator in this niche publishes a translation-cost benchmark.
A benchmark published here would be the first party measurement in this niche.

## Benchmark design

1. Pin one JSON corpus per feature: text, tools, images, thinking blocks.
2. Measure request conversion, response conversion, and a stream pipeline.
3. Run paired cases on the same Node build and the same host.
4. Report median and p95 wall time, plus round-trip fidelity.
5. Keep the corpus and the runner in this repository so the results are reproducible.

## Excluded for now

- `token.js` and `aisuite` translate one direction only and hide conversion
  inside a network client.
- `@antseed/api-adapter` names no license and no source repository.
- `Vercel AI SDK` and `LangChain` keep their converters private.
