# Translation benchmark

## Scope

This benchmark measures the three exports in `translate/src/index.mjs`.
The benchmark does not edit the package under test.
The benchmark compares provider-bridge with LiteLLM 1.74.9.
The run date is 2026-11-10.

Provider-bridge had a lower median in all 15 paired cases.
The LiteLLM median was 3.19 to 45.37 times the provider-bridge median.
No paired case showed a median latency loss for provider-bridge.
These results apply only to these fixtures, functions, and this host.

## Competitor selection

Setup research found these public projects on 2026-11-10.
The star counts and creation dates are setup-time observations.
They do not come from the offline benchmark run.

| Project | Stars observed | Created | Decision |
| --- | ---: | --- | --- |
| BerriAI/litellm | 63,048 | 2023-07-27 | Measured |
| 1rgs/claude-code-proxy | 3,763 | 2025-03-19 | Excluded |
| fuergaosi233/claude-code-proxy | 2,803 | Not recorded | Excluded |
| musistudio/claude-code-router | 38,080 | Not recorded | Excluded |

LiteLLM 1.74.9 was uploaded on 2025-07-28.
That release is more than 90 days old on the run date.
The measured adapter exposes direct in-process JSON and stream functions.
LiteLLM satisfies the adoption and age rules.

The installed Claude Code Proxy distribution exposed no verified translation callable.
Its package metadata also required LiteLLM 1.71.1.
The isolated environment used LiteLLM 1.74.9 instead.
This replacement caused a dependency-conflict warning during setup.
The conflict affected only `/tmp/t2b-venv`.
No source callable was verified for the other proxy fork.
Claude Code Router depends on external providers rather than one direct standalone conversion pair.
These projects were not measured because a suitable in-process callable was not verified.
The PyPI name `anthropic-to-openai` returned HTTP 404 during setup.
No measured claim covers that name.

## Runtime

The benchmark ran on Linux arm64 with 20 logical CPUs.
The JavaScript runtime was Node.js v25.8.1.
The Python runtime was Python 3.12.3.
The LiteLLM environment used OpenAI 3.49.0 and Pydantic 2.11.5.

The harness uses Node.js standard modules only.
`run.sh` generates shared fixtures and starts both benchmark suites.
`bench.mjs` imports the package from `../translate/src/index.mjs`.
The isolated LiteLLM helper runs under `/tmp/t2b-venv/bin/python -I`.
Python source and dependency files stay outside the repository.

Prepare the isolated environment during setup.

```bash
python3 -m venv /tmp/t2b-venv
/tmp/t2b-venv/bin/pip install litellm==1.74.9
```

Run the complete benchmark from the repository root.

```bash
bash provider-bridge/bench/run.sh
```

The runtime requires the prepared `/tmp/t2b-venv` environment.
The runner makes no dependency changes.
The runtime makes no network calls.
The runner writes fixtures and raw results under `/tmp`.
Set `T2B_PYTHON` to use another prepared Python executable.
Set `T2B_FIXTURES` or `T2B_RESULTS` to change the scratch paths.

## Method

The deterministic seed is `20261110`.
The fixture labels are `1k`, `100k`, and `1M`.
The target contents contain about 4,000, 400,000, and 4,000,000 characters.
The fixtures include text, reasoning, tools, and token usage.
The stream cases contain 100, 1,000, or 10,000 content chunks.
`fixtures/README.md` defines the file formats.

Both packages receive identical fixture files.
Each case runs 20 warmups before 100 measured iterations.
Each stream iteration creates a fresh stream converter and consumes all output.
The Node.js timer uses `process.hrtime.bigint` and `node:perf_hooks`.
The Python timer uses `time.perf_counter_ns`.
The table reports median and p95 wall time.

JSON fixture parsing stays outside both timed JSON boundaries.
Pydantic response-model construction stays inside the LiteLLM response timing.
Both stream boundaries include OpenAI SSE parsing and Anthropic SSE emission.
The boundaries do not include an LLM call or network transport.
The harness checks that each measured stream emits output.

Throughput uses decimal megabytes of fixture input per median second.
The token estimate divides input bytes by four.
The token estimate is not a tokenizer count.
Node.js `heapUsed` delta covers each complete measured case after warmups.
The harness clamps a negative Node.js heap delta to zero.
Python heap delta is unavailable and appears as `n/a`.
The timed conversions can retain references to immutable input strings.
Input byte rates therefore do not imply full string copying in every case.

## Results

The ratio column divides the LiteLLM median by the provider-bridge median.
The table repeats the raw milliseconds to expose differences below 0.001 milliseconds.

| Operation | Size | Bridge median ms | LiteLLM median ms | Ratio | Bridge p95 ms | LiteLLM p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| anthropic_to_openai_json | 1k | 0.002624 | 0.008368 | 3.19x | 0.006144 | 0.008832 |
| openai_to_anthropic_json | 1k | 0.000656 | 0.027568 | 42.02x | 0.000864 | 0.028432 |
| openai_to_anthropic_stream_100 | 1k | 0.174977 | 4.138222 | 23.65x | 0.325617 | 4.152327 |
| openai_to_anthropic_stream_1000 | 1k | 1.135687 | 35.767401 | 31.49x | 2.010010 | 35.824785 |
| openai_to_anthropic_stream_10000 | 1k | 3.861045 | 142.786301 | 36.98x | 5.080731 | 143.112730 |
| anthropic_to_openai_json | 100k | 0.007600 | 0.078001 | 10.26x | 0.010096 | 0.081264 |
| openai_to_anthropic_json | 100k | 0.000608 | 0.027584 | 45.37x | 0.000720 | 0.028113 |
| openai_to_anthropic_stream_100 | 100k | 0.595027 | 5.334469 | 8.97x | 1.335895 | 5.348781 |
| openai_to_anthropic_stream_1000 | 100k | 1.553464 | 42.735521 | 27.51x | 2.260428 | 42.852266 |
| openai_to_anthropic_stream_10000 | 100k | 12.344419 | 409.670408 | 33.19x | 14.692495 | 410.695360 |
| anthropic_to_openai_json | 1M | 0.095552 | 0.709132 | 7.42x | 0.110865 | 0.713891 |
| openai_to_anthropic_json | 1M | 0.000608 | 0.027440 | 45.13x | 0.000752 | 0.027872 |
| openai_to_anthropic_stream_100 | 1M | 3.058368 | 15.005044 | 4.91x | 5.774639 | 15.209445 |
| openai_to_anthropic_stream_1000 | 1M | 4.942170 | 52.539701 | 10.63x | 10.405528 | 52.791111 |
| openai_to_anthropic_stream_10000 | 1M | 15.479700 | 423.822673 | 27.38x | 19.745658 | 424.368635 |

The command also prints MB/s, estimated tokens/s, and heap delta for all 30 rows.
The complete verification output is in the T2b receipt.
The exact raw results are in `/tmp/t2b-results.json` after the run.

## Limits

This comparison crosses JavaScript and Python runtimes.
The ratios do not isolate translation algorithm cost from runtime cost.
Pydantic construction and LiteLLM stream lifecycle work remain in the measured functions.
The benchmark uses repeated synthetic text and one response shape.
These inputs do not measure every content block, tool stream, or malformed input.
The benchmark does not measure semantic equivalence of every emitted event.
The timer resolution affects JSON cases with sub-microsecond medians.
A single sequential run does not establish variance across hosts or process starts.
p95 values come from 100 iterations per case.
The results do not measure end-to-end proxy throughput or production concurrency.
