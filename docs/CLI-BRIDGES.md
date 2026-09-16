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

The actual Kilo executable passed a local model fixture covering tool denial in the engine, approval in Robinhood, a single file write, and receipt handoff. Live checks returned an empty structured reply from Liquid and a quota error from Poolside; neither counts as successful task inference. Empty replies now fail explicitly. Kilo can retry internally; a retry-limit setting is supplied in addition to Robinhood's deadline.

### Gemini CLI (implemented)

Run `robinhood login gemini-cli` in a normal terminal, complete Gemini's Google sign-in, then use `/quit` to close the native CLI. Start `robinhood`, run `/connect gemini-cli`, and choose a model with `/models gemini-cli`. No API key is requested. This is distinct from `/connect gemini`, which uses the Gemini API.

The pinned Gemini CLI 0.60.0 owns OAuth and refresh in a dedicated profile under Robinhood's default application data directory (`cli-profiles/gemini`). Existing personal Gemini settings and credentials are not copied. Profiles are shared across Robinhood workspaces and `--data-dir` overrides, just like saved accounts. `/disconnect` removes the Robinhood connection marker; it does not revoke Google's native cached authorization. Use the native CLI's `/logout` through `robinhood login gemini-cli` to remove that authorization. Gemini's own credential storage is separate from Robinhood's OS vault.

Headless requests use stdin for task content, a dedicated empty workspace, no API-key environment fallback, disabled hooks/extensions/skills, an empty native tool registry, and a deny-all tool policy. Validated JSON proposals go through Robinhood's approvals. Replies appear after completion. Native CLI state can contain temporary conversation copies; it is not encrypted by Robinhood. Remaining free allowance and model eligibility depend on the Google account; a successful sign-in does not prove a free balance. The model list is a reviewed list of CLI model IDs, not account-specific discovery. Gemini can route or retry internally within the request deadline.

Validation uses the actual Gemini executable against a local API fixture, verifies no native tool declarations are exposed, and completes one Robinhood-approved file write with receipt handoff. Real Google-authenticated inference remains unverified because no account has been signed into this dedicated profile. Tests use a synthetic key and loopback endpoint only; that fixture mechanism is not exposed in the terminal UI.

### GitHub Copilot CLI (implemented)

Run `robinhood login copilot-cli` to authorize GitHub through the native CLI. Then run `robinhood`, `/connect copilot-cli`, and `/models copilot-cli`. The pinned CLI is 1.0.85. A dedicated `cli-profiles/copilot` profile and cache keep its configuration separate from your existing Copilot installation. Tokens remain managed by Copilot; its documented credential-store fallback may use a local plaintext file when a system vault is unavailable. Robinhood does not import `GH_TOKEN`, `GITHUB_TOKEN`, API keys, or BYOK configuration.

GitHub documents CLI access across Copilot plans, but allowance and model access remain account-dependent. A request may consume paid credits, so Robinhood requires confirmation each time. The picker contains reviewed model IDs; it is not proof your account can access every listed model. There is no balance discovery or automatic paid fallback implemented by Robinhood.

Native tools are removed with an explicit nonmatching allowlist (an empty allowlist enables defaults in this version). Additional deny rules, disabled built-in MCP servers, a dedicated empty workspace, no custom instructions, and disabled remote export retain the intended model-only boundary. Prompts use stdin; structured model text is extracted from JSONL assistant events only after a successful completion record. Plain terminal text is not parsed because the CLI formats it and can alter JSON. Replies are shown after completion. Native profiles may retain task copies; these are separate from Robinhood's journal. `/disconnect` removes the connection marker, not the provider's remote authorization.

The real Copilot executable passed a loopback model fixture: no native tool definitions in requests, a single approved Robinhood file write, and receipt handoff. Parser tests reject missing completion, errors and unexpected native tool activity. GitHub-authenticated inference remains unverified until you authorize this profile. Copilot can retry or make utility requests within Robinhood's two-minute deadline.

References: [Copilot availability](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli), [native authentication and CLI flags](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [configuration and credential storage](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference).

- A CLI is not an additional token allowance unless its provider grants one.
- The CLI owns its supported login and token refresh. Robinhood does not extract browser cookies or reuse a private OAuth client.
- Advertised free routes, account-dependent allowances, and subscriptions must remain distinct.
- External engines can retry internally. They must have a bounded lifetime and expose that limitation.
- Native tools are disabled; only validated suggestions enter Robinhood's approved execution path.

References: [Kilo CLI](https://kilo.ai/docs/code-with-ai/platforms/cli), [Gemini headless mode](https://geminicli.com/docs/cli/headless/), [Gemini policy engine](https://geminicli.com/docs/reference/policy-engine/).
