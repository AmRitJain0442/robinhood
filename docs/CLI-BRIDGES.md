# Additional coding CLI bridges

This work extends the existing OpenCode bridge one engine at a time. Each adapter must retain Robinhood's task history, approvals and receipts, stop its owned process on cancellation, and report account requirements accurately.

## Implementation sequence

1. Share the OpenCode-compatible process boundary without changing OpenCode behavior.
2. Add Kilo CLI with a pinned engine, isolated configuration, catalog-based free-model selection, and native protocol tests.
3. Add Gemini CLI with native Google sign-in in a dedicated profile, headless requests, denied native tools, and portable structured suggestions.
4. Assess further CLIs against the same execution and authentication requirements. Document unsupported integrations instead of exposing API-key placeholders as CLI bridges.

Every functional step gets its own tested commit. Live checks use only public synthetic prompts. Authenticated checks require an actual signed-in account and are labeled unverified until performed.

## Access principles

### Kilo CLI (implemented)

Use `/connect kilo-cli`, choose **Launch Kilo free-model bridge**, then `/models kilo-cli`. This is separate from the direct `/connect kilo` API connector. The pinned Kilo 7.7.2 process uses an isolated profile, no account keys, and the same structured suggestions and Robinhood approval path as OpenCode. Only explicit `:free` model IDs with zero advertised input/output/cache prices and tool support are selectable; automatic routers are excluded. Catalog metadata is not a remaining-balance guarantee. Requests require public-data consent and have a two-minute deadline.

The actual Kilo executable passed a local model fixture covering tool denial in the engine, approval in Robinhood, a single file write, and receipt handoff. Live model inference is not yet verified. Kilo can retry internally; a retry-limit setting is supplied in addition to Robinhood's deadline.

- A CLI is not an additional token allowance unless its provider grants one.
- The CLI owns its supported login and token refresh. Robinhood does not extract browser cookies or reuse a private OAuth client.
- Advertised free routes, account-dependent allowances, and subscriptions must remain distinct.
- External engines can retry internally. They must have a bounded lifetime and expose that limitation.
- Native tools are disabled; only validated suggestions enter Robinhood's approved execution path.

References: [Kilo CLI](https://kilo.ai/docs/code-with-ai/platforms/cli), [Gemini headless mode](https://geminicli.com/docs/cli/headless/), [Gemini policy engine](https://geminicli.com/docs/reference/policy-engine/).
