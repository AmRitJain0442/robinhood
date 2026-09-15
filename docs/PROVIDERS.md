# Provider roadmap and allowance policy

**Evidence checked:** 2026-09-15. **Implementation status:** no Robinhood provider integration has been built or live-tested yet.

This is an engineering shortlist derived from the broader free-access research. An entry means a candidate worth implementing or investigating; it does not imply a working connector or an entitlement available to every user.

## Launch: three model APIs

| Provider | Planned connection | Published allowance signal | What Robinhood must verify |
| --- | --- | --- | --- |
| OpenRouter | API key; explicit eligible free model routes | Free plan lists 50 requests/day and 20 requests/minute; this is not a daily token grant | Current route pricing, tool support, account-specific limits, and any underlying provider restrictions |
| Gemini Developer API | API key tied to a Google project | Selected models have a free tier; current limits appear in AI Studio and vary by project/model | Project billing tier, selected model's free eligibility, request/token windows, and data-use disclosure |
| Groq | API key on an eligible free account | Model-specific request and token ceilings; some listed free-plan models have 200,000 tokens/day | Actual account/model limits, quota grouping, supported tools, and response usage/reset metadata |

Sources: [OpenRouter pricing](https://openrouter.ai/pricing), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Groq limits](https://console.groq.com/docs/rate-limits).

These providers cover a gateway, a native model API, and a second inference API without requiring a large integration surface. Choose exact model IDs during M1 from the then-current catalog and test them. A zero-priced model that cannot reliably use tools is not automatically suitable for a coding loop.

Gemini quotas apply to a project, not separately to every key; its daily request window resets at midnight Pacific time. Use timezone-aware reset handling. Its published free-tier data-use terms also differ from paid usage; surface that during connection. [Gemini limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Expansion order

### 1. More model routes

| Candidate | Integration shape | Gate before scheduling |
| --- | --- | --- |
| OpenCode Zen | Model gateway, separate from the OpenCode execution engine | Current free models, promotion expiry, privacy terms, API access, and no silent paid fallback |
| Cloudflare Workers AI | Account/token-based inference API | Selected model eligibility and neuron accounting; the documented 10,000-neuron daily allocation is not 10,000 tokens |
| Mistral, Hugging Face, Vercel AI Gateway | Provider-specific APIs or gateways | Refresh official credit/plan evidence, authentication, account eligibility, and rollover behavior |
| NVIDIA and other evaluation APIs | Evaluation model endpoints | Confirm current evaluation terms, allowed data, intended use, and usable automation interface |
| Trial-credit providers | API with expiring promotional balance | Add only with clear balance/expiry behavior and a way to prevent unapproved paid rollover |
| Ollama / other local engines | Local model server | Hardware requirements, actual tool capability, and context limits; classify as local compute rather than hosted free tokens |

Verified reference points: [OpenCode Zen](https://opencode.ai/docs/zen/) describes its gateway and free-model conditions; [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) defines neuron accounting. The other rows are investigation candidates, not renewed free-offer claims. Each needs a dated official-source entry before implementation is scheduled.

### 2. Official coding-agent sessions

Account login and API access are different products. Integrate an official agent through its documented app-server, SDK, headless CLI, or agent protocol. Do not extract its subscription token and assume it authorizes arbitrary model API calls.

| Candidate | Interface to evaluate | Product fit |
| --- | --- | --- |
| Codex | Official app-server | Embed an agent session and its approvals; investigate explicit context handoff |
| Antigravity CLI | Official headless interface | Run a supported agent session with its documented lifecycle |
| GitHub Copilot CLI | Official CLI/SDK interface | Evaluate account eligibility, streaming events, and permission ownership |
| Kiro, Cursor, CodeBuddy, Qoder | Official automation interface, if currently available for the user's tier | Separate feasibility checks; interactive access alone does not establish headless entitlement |
| Jules | Official asynchronous repository-job interface | Display and track a separate job; it is not a drop-in streamed model response |

Documented starting interfaces: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Antigravity headless mode](https://www.antigravity.google/docs/cli/headless/), [Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli). Account allowances must be verified separately. No daily token total is asserted for these sessions.

An agent integration must expose who owns tool approval, how cancellation works, where history is stored, and whether context can be imported/exported. Begin with explicit handoff after a completed turn. Do not pretend two independent agents share an interchangeable internal transcript.

### 3. Complementary tools

Search, page retrieval, embeddings, image generation, transcription, speech, and remote compute belong in a later tool catalog. Their requests, credits, seconds, images, or GPU hours remain separate from text-model allowance. Start only when a supported coding workflow needs the tool, and test its own authentication and side effects.

Consumer chat and media web apps with no supported automation interface remain outside automated routing. A web login by itself is insufficient evidence of API access.

## Free-access policy

The first release has one default policy: **use only configured eligible free access; pause when no eligible route remains.** Paid routing is outside the initial release scope.

Eligibility can come from:

1. A currently verified zero-priced model route whose request options cannot silently select a paid variant.
2. A provider-enforced free account/project tier for the selected model.
3. In a later credit integration, a known promotional balance with explicit expiry and a verified hard stop before paid rollover.

Record whether account-tier evidence is provider-reported or user-declared. A user declaration can document setup but must not by itself authorize an automatic route capable of paid rollover. Where the provider cannot expose or enforce the necessary billing boundary, block automatic free-access routing and explain the limitation. Unknown remaining *quantity* is acceptable for an otherwise verified free-only route; unknown *price eligibility* is not.

Check model catalog freshness at connection and before starting a new session. Use documented machine-readable metadata where available; otherwise use a versioned, dated reviewed record with a provider-specific expiry. An expired record cannot authorize a new session automatically. Do not scrape arbitrary pricing pages as a runtime dependency.

Apply the policy to retries, helper models, summarization, built-in search, and gateway fallback behavior. A free text route does not authorize a separately charged tool. Restrict gateway upstream routing when the user's project policy requires it; if that restriction cannot be guaranteed, exclude the route for that project.

Robinhood can enforce which requests it sends. It cannot guarantee a provider's billing system or detect every external account-setting change. Use provider-side controls where available and state the evidence boundary clearly.

## Allowance display and accounting

Store and display native units:

| Kind | Display example | Do not infer |
| --- | --- | --- |
| Requests | `12 observed / 50 published requests per day` | A fixed number of tokens per request |
| Tokens | `input/output usage reported by provider` | Identical counting across models or providers |
| Rate ceiling | `8,000 tokens per minute` | A grant of that amount every minute for a full day |
| Money/credits | `promotional balance; expires on ...` | A recurring daily token entitlement |
| Task or agent credits | `remaining when the official interface reports it` | Raw model API tokens |
| Local compute | `model running on this device` | Free electricity or unlimited hardware capacity |

Label each number as provider-reported, locally observed, estimated, published ceiling, or unknown. Group shared quotas at the account/project level. Multiple API keys, model aliases, and gateways can overlap; summing rows is invalid without evidence of independent pools.

An optional capacity estimate may use an explicitly chosen workload, such as 4,000 input and 1,000 output tokens per request. Show its assumptions, context overhead, and limiting request/token windows. Never present that estimate as tokens guaranteed per day.

## Acceptance checklist for a provider

An integration PR must contain:

- Official interface, pricing/allowance, and relevant data-use links with verification date.
- Authentication method, account/region/tier restrictions, quota scope, reset semantics, and expiration conditions.
- Selected tested models and capability results, including tool-call/result and context behavior.
- Evidence of free-route enforcement, including gateway/internal retry behavior and paid rollover controls.
- Fixtures for success, cancellation, invalid credentials, quota errors, partial output, and unavailable usage data.
- A redacted, opt-in live verification record if performed; absence of live verification must remain visible.
- Connection/disconnection instructions and an explanation of any engine-owned credential or session storage.

Keep evidence updates separate from behavior changes when practical. Deprecate a retired route, stop selecting it, preserve existing sessions, and offer the next eligible route or a clear pause.
