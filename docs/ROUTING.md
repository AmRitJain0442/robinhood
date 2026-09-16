# Automatic model chaining

Run `robinhood`, connect providers with `/connect`, then enter your task. Automatic chaining is on by default; there is no need to choose every model manually.

## What enters the pool

- All eligible models discovered from **connected OpenRouter, Kilo API, OpenCode CLI, and Kilo CLI** catalogs. These connectors filter for zero pricing and tool support and recheck eligibility for requests.
- One model explicitly selected with `/models` or `/use`, including an account-dependent model. Such a model may consume paid credits under the existing permission policy.
- Other account-dependent providers are excluded from automatic discovery because their connectors cannot prove the account has free allowance. Connecting an account alone does not authorize adding its potentially paid models to the automatic pool. AI Horde is excluded because it is text-only.

No accounts are created, no quotas are bypassed, and no credits are transferred. Multiple models or CLI/API frontends can share the same upstream allowance; their quotas are not additive.

## How handoffs work

Catalogs are discovered concurrently at the start of each task turn or workflow invocation. An unavailable catalog does not prevent discovery from other providers. The current session's last working route goes first; an explicit selection changes that preference. Other discovered models are ordered by context size within each provider. This is a deterministic fallback order, not a model-quality ranking.

On a typed quota, capacity, or authentication error, Robinhood logs the handoff and tries the next route. Context, constraints, plan mode, and completed tool receipts stay in the same session. Foreign provider-specific metadata is converted by the existing connector adapters. Failed partial output stays in diagnostic events, not completed history; it cannot launch a tool.

Failed routes receive process-local cooldowns: provider Retry-After where available, otherwise 15 minutes for quota, one minute for capacity, or five minutes for authentication. These are retry delays, not claims about actual quota reset times. Restarting the app clears cooldowns. A working route remains preferred in the saved session. Workflow steps and delegated research use the same pool.

Policy rejection, malformed responses, generic transport failures, cancellation, and uncertain tool outcomes stop execution instead of triggering fallback. A price change fails closed. Automatic context compaction is not included; use `/compact` when needed. Compaction uses a single selected route.

The loop stops when a model returns its final response, all routes fail, or 100 successful model steps finish. Failed routes do not consume this step budget. Use `/continue` after a pause; Ctrl+C cancels active work. It does not generate extra requests merely to spend unused tokens after a final response.

## Controls and verification

- `/chain`: explain the active policy.
- `/chain on`: enable automatic free-model fallback (default).
- `/chain off`: use only the model explicitly selected with `/use` or `/models`.
- `/status`: inspect locally observed request usage; this is not a provider balance.

The routing fixtures cover discovery, account exclusion, cooldown recovery, cancellation, failed catalogs, more than twelve exhausted routes, saved-route preference, and policy rejection. Existing recovery tests verify a completed tool is not replayed after a quota handoff. Actual live quota exhaustion across providers has not been tested.
