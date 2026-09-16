# Integration ledger

**25 cloud API connectors: 23 standard coding connectors, 1 experimental coding connector (Puter), and 1 text-only connector (AI Horde).**

Connectors are implemented one at a time and share the same local task journal. **Implemented** means the protocol, authentication handling, and failure behavior have automated fixture coverage. It does not mean a real account was tested or that every account gets free usage.

| Provider | Interface | Access policy | Validation |
| --- | --- | --- | --- |
| OpenRouter | Chat Completions streaming | Live catalog must report an explicit zero-priced `:free` tool-capable route | HTTP fixtures, public catalog, cross-platform CI; real-account inference unverified |
| Gemini | Native `streamGenerateContent` | Account-dependent; confirmation before every inference request | HTTP fixtures, native tool/signature round-trip, portable history; real-account inference unverified |
| Groq | Chat Completions streaming | Account-dependent; confirmation before every inference request | HTTP fixtures, Groq token-limit field and usage formats; real-account inference unverified |
| Mistral | Chat Completions streaming | Account-dependent; confirmation before every inference request | HTTP fixtures, capability discovery, native tool IDs; real-account inference unverified |
| Kilo | Chat Completions streaming, optional API key | Live explicit zero-priced routes; confirmation of public-data use | HTTP fixtures and public catalog; inference validation below |
| Inception | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Cerebras | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| SambaNova | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Z.ai | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| OpenCode Zen | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Cline API | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Vercel AI Gateway | Chat Completions streaming | Account-dependent; confirmation each request | HTTP capability-filter fixtures, public catalog; real-account inference unverified |
| Hugging Face | Chat Completions streaming | Account-dependent; explicit upstream selection | HTTP catalog-withdrawal fixtures, public catalog; real-account inference unverified |
| NVIDIA API Catalog | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Fireworks AI | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Scaleway | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Sarvam AI | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Poolside | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Alibaba Model Studio | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Ollama Cloud | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Cohere | Chat Completions streaming | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| Cloudflare Workers AI | Account-scoped Chat Completions | Account-dependent; confirmation each request | HTTP tool contracts and account-path validation; real-account inference unverified |
| AI21 | Non-streaming Chat Completions | Account-dependent; confirmation each request | HTTP contract fixtures; real-account inference unverified |
| AI Horde | Queued text generation; no coding tools | Public-data confirmation; anonymous or account key | HTTP submit/status/cancellation fixtures, public catalog; inference unverified |
| Puter | Experimental native driver, non-streaming normalized chat | User auth token; account-dependent confirmation | Source-reviewed HTTP fixtures; live endpoint timed out, real account unverified |

## Connecting multiple providers

```text
/connect openrouter
/connect gemini
/models gemini
/use gemini gemini-3.8-flash
```

Select an actual model from the current `/models PROVIDER` list. Connections coexist in this process. `/use PROVIDER MODEL` changes the active route without resetting the task. `/disconnect PROVIDER` removes one connection. Keys are not persisted.

OpenRouter also accepts `OPENROUTER_API_KEY`; Gemini accepts `GEMINI_API_KEY`. Environment credentials do not authorize inference on account-dependent routes by themselves.

## Free access versus account-dependent access

The default automatic policy still requires verified free access. Some APIs expose models but do not expose whether an API key belongs to a free billing tier, a funded trial, or a paid account. Those connectors are **manual only**: Robinhood explains the uncertainty and requires explicit consent for each request. It does not infer a free balance from a successful login, and it does not silently spend a paid account.

If you require strictly machine-verifiable zero-price routing, decline account-dependent requests. Use provider-side free-only or spending controls where available. Request confirmation is permission to use the account; it is not verification that the request is free.

## Gemini evidence — checked 2026-09-15

Uses API-key authentication in the `x-goog-api-key` header, native streaming, function declarations, and function responses. The selected model must exist in the authenticated model catalog. Opaque thought signatures are retained only for continuation on the originating Gemini model. When changing models/providers, visible work and receipts become historical text instead of incompatible native tool records.

References: [GenerateContent API](https://ai.google.dev/api/generate-content), [model catalog](https://ai.google.dev/api/models), [thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [billing](https://ai.google.dev/gemini-api/docs/billing).

The connector does not enable built-in web search, code execution, media generation, or paid fallback. Function calls go through Robinhood's local permission boundary. Account tier, remaining allowance, regional availability, and model quality still need real-account verification.

## Groq evidence — checked 2026-09-15

Connect with `/connect groq` or `GROQ_API_KEY`, then `/models groq` and `/use groq MODEL`. The connector intersects its reviewed tool-capable models with the authenticated model catalog, uses `max_completion_tokens`, and handles both standard usage and Groq's usage metadata. It does not enable Compound's server-side tools. Published model rate ceilings are not added together as independent daily grants.

References: [API reference](https://console.groq.com/docs/api-reference), [compatibility](https://console.groq.com/docs/openai), [tool use](https://console.groq.com/docs/tool-use/overview), [rate limits](https://console.groq.com/docs/rate-limits).

## Mistral evidence - checked 2026-09-15

Connect with `/connect mistral` or `MISTRAL_API_KEY`. The authenticated catalog must explicitly declare chat and function-calling support; archived models and invalid context sizes are excluded. Trial credit and billing status remain account-dependent.

References: [models API](https://docs.mistral.ai/api/endpoint/models), [chat API](https://docs.mistral.ai/api), [function calling](https://docs.mistral.ai/studio/conversations/function-calling).

## Kilo evidence - checked 2026-09-15

`/connect kilo` accepts an empty key for documented anonymous access; optionally use `KILO_API_KEY`. Only explicit `:free` model IDs with `isFree: true`, all reported prices zero, and declared tools are exposed. Automatic model selectors are excluded. Pricing is refreshed before every request. Free endpoints may use prompts for improvement; confirmation requires public, non-confidential data. NVIDIA endpoints are trial-only. Anonymous rate ceilings do not guarantee capacity or a daily token grant.

References: [API](https://kilo.ai/docs/gateway/api-reference), [models, free access and data terms](https://kilo.ai/docs/gateway/models-and-providers).

Live anonymous smoke test succeeded on `poolside/laguna-s-2.1:free`: a fixed public prompt returned `OK`, reporting 443 input and 2 output tokens. No workspace data was sent or tools executed. The catalog exposed 16 eligible explicit free tool models at test time. This verifies one route, not all model quality, quota guarantees, or live tool execution.

## Inception evidence - checked 2026-09-15

Connect with `/connect inception` or `INCEPTION_API_KEY`. Uses the Mercury chat models and the completion-token limit. Edit/FIM models are excluded because they lack the agent tool interface. Signup credits are not a recurring daily grant.

References: [models and endpoints](https://docs.inceptionlabs.ai/get-started/models), [chat API](https://docs.inceptionlabs.ai/api-reference/chat/create-a-chat-completion).

## Cerebras evidence - checked 2026-09-15

Connect with `/connect cerebras` or `CEREBRAS_API_KEY`. Uses the smaller published trial context limits and rechecks model availability. Trial balance and account rate limits remain unverified; older daily-token claims are not used.

References: [quickstart](https://inference-docs.cerebras.ai/quickstart), [model catalog](https://inference-docs.cerebras.ai/models/overview), [chat API](https://inference-docs.cerebras.ai/api-reference/chat-completions).

## SambaNova evidence - checked 2026-09-15

Connect with `/connect sambanova` or `SAMBANOVA_API_KEY`. Uses reviewed production tool models and requests streaming usage. Preview and dedicated deployment models are excluded. Model-specific ceilings are not summed into a guaranteed account allowance.

References: [function calling](https://docs.sambanova.ai/docs/en/features/function-calling), [model catalog](https://docs.sambanova.ai/docs/en/models/sambacloud-models), [endpoint](https://docs.sambanova.ai/docs/en/integrations/make).

## Z.ai evidence - checked 2026-09-15

Connect with `/connect zai` or `ZAI_API_KEY`. Uses the standard API with the reviewed Flash variants, not the paid Coding Plan endpoint. Thinking is disabled so tool continuation does not depend on reasoning replay. Model IDs come from documentation; this adapter does not claim account catalog discovery. Free promotional pricing is not machine-verified.

References: [quickstart](https://docs.z.ai/guides/overview/quick-start), [GLM 4.7 variants](https://docs.z.ai/guides/llm/glm-4.7), [chat API](https://docs.z.ai/api-reference/llm/chat-completion).

## OpenCode Zen evidence - checked 2026-09-15

Connect with `/connect zen` or `OPENCODE_ZEN_API_KEY`. Supports the five documented promotional models served through Chat Completions, with a conservative 64K app budget. Muse Spark Contributor uses Responses and is not exposed by this adapter. The catalog has no price fields, so promotion status remains manual. These are direct Zen API credentials, not an OpenCode process bridge.

References: [models, endpoints, pricing and data terms](https://opencode.ai/docs/zen/), [public catalog](https://opencode.ai/zen/v1/models).

## Cline API evidence - checked 2026-09-15

Connect with `/connect cline` or `CLINE_API_KEY`. Uses Cline's documented API and reviewed MiniMax chat/tool route with a conservative 64K app budget. The public catalog lacks pricing, so a model label does not authorize automatic free routing. Cline's own CLI agent and its OAuth session are separate integrations.

References: [chat API](https://docs.cline.bot/api/chat-completions), [models](https://docs.cline.bot/api/models).

## Vercel evidence - checked 2026-09-15

Connect with `/connect vercel` or `AI_GATEWAY_API_KEY`. Discovers language models explicitly declaring tool support. Gateway upstream selection, monthly credit eligibility and any usage beyond the grant remain account-dependent.

References: [REST API](https://vercel.com/docs/ai-gateway/openai-compat/rest-api), [models](https://vercel.com/docs/ai-gateway/models-and-providers), [pricing](https://vercel.com/docs/ai-gateway/pricing).

## Hugging Face evidence - checked 2026-09-15

Connect with `/connect huggingface` or `HF_TOKEN`. Models are listed as `organization/model:provider`, pinning a live upstream with declared tools. The token needs Inference Providers permission. Routed monthly credits do not apply to independently billed provider keys; neither a free balance nor shared quota is inferred.

References: [function calling and provider selection](https://huggingface.co/docs/inference-providers/en/guides/function-calling), [pricing](https://huggingface.co/docs/inference-providers/en/pricing), [live catalog](https://router.huggingface.co/v1/models).

## NVIDIA API Catalog evidence - checked 2026-09-15

Connect with `/connect nvidia` or `NVIDIA_API_KEY`. Connects the hosted catalog's reviewed Llama tool model. This is not a local NIM deployment or a production inference entitlement. Evaluation access and remaining allowance need account verification.

References: [model API](https://docs.api.nvidia.com/nim/reference/meta-llama-3_3-70b-instruct), [trial terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf).

## Fireworks AI evidence - checked 2026-09-16

Connect with `/connect fireworks` or `FIREWORKS_API_KEY`. Uses the documented serverless GPT-OSS tool model. Dedicated deployments are excluded. The reviewed model list is static; signup credit and availability require account verification.

References: [chat API](https://docs.fireworks.ai/api-reference/post-chatcompletions), [serverless model](https://fireworks.ai/models/fireworks/gpt-oss-120b).

## Scaleway evidence - checked 2026-09-16

Connect with `/connect scaleway` or `SCALEWAY_API_KEY`. Uses the documented Gemma tool route with a conservative 64K app budget and the default project endpoint. Dedicated deployments and GPT-OSS Responses-only features are not exposed. Signup credits remain account-dependent.

References: [tool integration](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrating-generative-apis-with-popular-tools/), [API reference](https://www.scaleway.com/en/developers/api/generative-apis).

## Sarvam AI evidence - checked 2026-09-16

Connect with `/connect sarvam` or `SARVAM_API_KEY`. Uses the native subscription-key header and the documented v1 chat/tool interface. Reasoning is disabled for portable continuation. Audio, translation and beta v2 third-party models are separate APIs and are not exposed here.

References: [chat API](https://docs.sarvam.ai/api-reference/chat/chat-completions), [authentication](https://docs.sarvam.ai/api-reference/authentication).

## Poolside evidence - checked 2026-09-16

Connect with `/connect poolside` or `POOLSIDE_API_KEY`. Uses Poolside-hosted inference and its authenticated model list, with a conservative 64K app budget. First-party promotional access is separate from the same model's availability on Kilo or OpenRouter; allowances are not added together.

References: [API overview](https://docs.poolside.ai/api/overview), [models](https://docs.poolside.ai/get-started/supported-models).

## Alibaba Model Studio evidence - checked 2026-09-16

Connect with `/connect alibaba` or `DASHSCOPE_API_KEY`. Uses the Singapore international endpoint and a conservative 64K app budget. Keys and free quotas are region-specific. Enable the provider's Free Quota Only setting where available; Robinhood cannot verify that switch or the remaining quota. Other regions are not silently substituted.

References: [function calling](https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling), [free quota controls](https://www.alibabacloud.com/help/en/model-studio/new-free-quota).

## Ollama Cloud evidence - checked 2026-09-16

Connect with `/connect ollama` or `OLLAMA_API_KEY`. Uses direct cloud access through the documented compatibility API, with a conservative 64K budget. No local daemon or model download is needed. Cloud starter allowance and paid subscription entitlement remain account-dependent.

References: [cloud access](https://docs.ollama.com/cloud), [compatibility API](https://docs.ollama.com/api/openai-compatibility).

## Cohere evidence - checked 2026-09-16

Connect with `/connect cohere` or `COHERE_API_KEY`. Uses Cohere's documented compatibility API and tool-capable Command model with a conservative 64K budget. Omits the undocumented tool_choice parameter and disables thinking. Trial access is account-dependent; no production entitlement or fixed daily token allocation is inferred.

References: [compatibility API and supported parameters](https://docs.cohere.com/docs/compatibility-api), [trial limits](https://docs.cohere.com/docs/rate-limits).

## Cloudflare evidence - checked 2026-09-16

`/connect cloudflare` asks for an API token and account ID. Environment setup uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The reviewed Llama tool model has a 24K context limit. No Worker deployment is created. The shared neuron allowance is not converted into a guaranteed daily token balance.

References: [compatibility endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [model and limits](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/), [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## AI21 evidence - checked 2026-09-16

Connect with `/connect ai21` or `AI21_API_KEY`. Uses non-streaming requests because the documented Jamba tool interface requires stream=false. Responses are bounded and validated before any tool can execute. The static model list uses a conservative 64K budget; trial credits are account-dependent.

References: [chat request and streaming limitation](https://docs.ai21.com/reference/jamba-1-6-api-ref), [function calling](https://docs.ai21.com/docs/function-calling).

## AI Horde evidence - checked 2026-09-16

`/connect horde` accepts a blank key for anonymous access, or `AI_HORDE_API_KEY`. Only active text models are listed. Requests use a conservative 8K context and 512-token output cap; worker support can vary. Polling is bounded to two minutes and failed or cancelled requests trigger best-effort deletion of their job. No duplicate submission is retried. A disconnect during submission can leave a remote job whose ID was never received. Volunteer workers receive the prompt: public data only. Generated text never becomes a tool call.

References: [API schema](https://aihorde.net/api/), [developer overview](https://dev.aihorde.net/).

## Puter evidence - checked 2026-09-16

Connect with `/connect puter` or `PUTER_AUTH_TOKEN`, using a user auth token obtained through Puter's supported login flow. Robinhood does not ask for a Puter password or automatically create accounts. The experimental adapter implements the driver envelope reviewed in published `@heyputer/puter.js@2.6.3`, using direct cancellable HTTP with no SDK retries or upgrade dialogs. It currently supports the reviewed `gpt-4o-mini` route, requests normalized responses, and uses a conservative 64K budget. An experimental browser login is available through `/connect puter`; its official authme flow is wrapped with a private loopback callback and cancellation. The public endpoint timed out from the development environment; fixture coverage is not a live account test.

References: [Node authentication](https://docs.puter.com/getting-started/), [chat interface](https://docs.puter.com/AI/chat/), [response normalization](https://docs.puter.com/Objects/chatresponse/), [official SDK source](https://github.com/HeyPuter/puter/tree/main/src/puter-js).

## Scope and remaining validation

All 25 cloud API candidates in the research inventory have an implementation, with the limitations above. An additional [OpenCode CLI bridge](OPENCODE.md) launches the actual engine and routes advertised free models without an API key; anonymous Big Pickle passed a live smoke test. The CLI bridge is distinct from the direct Zen API connector. This does not cover every model on each platform, every way to obtain credits, or every consumer login. A gateway's model count is not a count of independent free allowances.

Three additional [native CLI bridges](CLI-BRIDGES.md) are implemented: Kilo CLI, Gemini CLI, and GitHub Copilot CLI. All pass real-executable local fixtures; Kilo CLI live probes did not complete successfully, and Google/GitHub-authenticated inference remains unverified. There are now 29 connector entries: 25 APIs and four CLI bridges.

Other agent bridges (Antigravity, Codex app-server, Kiro ACP, Cursor, CodeBuddy, Qoder, Jules, and Cline CLI) remain unimplemented. Their login, approval, process/session lifecycle, and crash recovery need separate adapters; they are not represented by API-key placeholders. Local inference runtimes and research/search/media services are also separate from these 25 cloud connectors.

OpenRouter browser authorization, experimental Puter browser login, and OS-vault credential persistence are implemented; see [account linking](ACCOUNTS.md). Real-account browser authorization remains unverified. Automatic live-provider fallback, quota discovery, and context compaction remain pending. Switching with `/use PROVIDER MODEL` keeps the durable journal. Gemini native signatures and Chat Completions continuation artifacts stay on their originating provider/model; foreign tool requests and receipts become historical text. Model-specific compatibility beyond the fixture cases still needs authenticated end-to-end testing.

A second anonymous Kilo probe on 2026-09-16, intended to test a live tool round-trip, received HTTP 429 before a tool call. It was not retried. The earlier plain-text live smoke test remains valid; live tool execution and available daily capacity remain unverified.
