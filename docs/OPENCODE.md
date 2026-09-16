# Use OpenCode's free models inside Robinhood

```sh
robinhood
```

Inside Robinhood:

```text
/connect opencode
/models opencode
```

Choose **Launch OpenCode free-model bridge**, select a model, and describe your task. No API key is requested. `/use opencode big-pickle` switches directly after connecting. Your Robinhood conversation and tool receipts stay with the task when switching back to other providers.

## How it works

Robinhood launches the pinned **OpenCode CLI 1.18.31** with `opencode serve` on an authenticated loopback port. This is the engine behind OpenCode's terminal, controlled through its supported server API. The Robinhood interface remains visible throughout. It does not type into or scrape another terminal screen.

```text
Robinhood UI + saved task history
             |
      local OpenCode CLI engine
             |
      advertised free Zen model
             |
      structured tool suggestions
             |
Robinhood approval -> execution -> saved receipt
```

The engine receives portable conversation history for each request. Its workspace tools are denied; only its structured-response tool is allowed. It returns suggestions for Robinhood's existing file and command tools, which retain the same approval and crash-recovery gates. OpenCode cannot directly edit the real project through this bridge.

Each engine request uses a temporary OpenCode session, deleted afterward. Robinhood's SQLite journal remains the task memory. Responses appear after OpenCode finishes the structured result; this bridge does not currently stream partial model text.

## Models and free-access limits

On September 16, 2026, the engine advertised six eligible routes:

- Big Pickle
- MiMo-V2.5 Free
- Ling 3.0 Flash Fin Free
- Nemotron 3 Ultra Free
- Nemotron 3.5 Lightning Free
- Muse Spark 1.3 Contributor Free

The picker intersects this reviewed list with OpenCode's catalog: models must support tool calls and advertise zero input, output, and cache pricing. Unknown prices, additional pricing tiers, deprecated routes, and unreviewed IDs are excluded. The catalog is checked again before each bridge request, not before each internal OpenCode retry. Catalog metadata is not a billing guarantee or a live allowance balance.

**There is no unlimited token pool.** Promotional availability, anonymous eligibility, rate limits, and service capacity can change. Remaining daily tokens are unknown. No personal OpenCode authentication, environment API keys, or paid-provider configuration is imported. Failed requests never switch to a paid model.

Each request asks for public-data consent because promotional endpoints may retain prompts for model improvement; NVIDIA free endpoints are trial-only. OpenCode can retry internally. Robinhood bounds the complete operation to two minutes, disables title/summary/compaction agents, and pins helper selection to a free model. Ctrl+C cancels and stops the owned engine; the next request can start a fresh one.

## Installation and lifecycle

The pinned CLI is an optional npm dependency, separate from any global OpenCode installation. Normal `npm ci` installs it on supported platforms. If optional packages were omitted, run `npm install --include=optional` in the Robinhood checkout, then `npm run build`.

OpenCode starts lazily when models are requested. `/disconnect opencode`, cancellation, errors, and normal Robinhood exit stop the owned process. Its authenticated server binds to `127.0.0.1` with a fresh password. Each launch uses isolated home, configuration, data, and workspace directories; project plugins and default plugins are disabled. Normal shutdown removes the owned temporary directory after verifying its location. A forced process/machine crash can leave temporary data under the OS temp directory with the `robinhood-opencode-` prefix. These transient copies are not encrypted or a forensic erasure mechanism.

Linking stores only an empty anonymous connection marker in the OS vault, so the connector can restore on restart. It does not store or copy an OpenCode account credential.

## Validation

- Real pinned OpenCode binary + local model fixture: structured tool proposal, approval before a file write, one execution, saved receipt in the next request, no native workspace tools exposed.
- Unit fixtures: free-price filtering, catalog withdrawal, malformed responses, cancellation, and reconnect.
- Live anonymous Big Pickle: returned `ROBINHOOD_OPENCODE_OK`; engine-reported usage was 1,007 input and 75 output tokens. No account key was supplied. Other listed models remain unverified for live inference.

The earlier [runtime decision](decisions/0001-direct-runtime.md) still applies to direct API connectors. This opt-in bridge preserves Robinhood's execution journal while explicitly exposing the external engine's retry limitations.

Primary references: [OpenCode server API](https://opencode.ai/docs/server/), [CLI serve/attach](https://opencode.ai/docs/cli/), [Zen pricing and data-use terms](https://opencode.ai/docs/zen/).
