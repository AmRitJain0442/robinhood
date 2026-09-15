# Integration ledger

Connectors are implemented one at a time and share the same local task journal. **Implemented** means the protocol, authentication handling, and failure behavior have automated fixture coverage. It does not mean a real account was tested or that every account gets free usage.

| Provider | Interface | Access policy | Validation |
| --- | --- | --- | --- |
| OpenRouter | Chat Completions streaming | Live catalog must report an explicit zero-priced `:free` tool-capable route | HTTP fixtures, public catalog, cross-platform CI; real-account inference unverified |
| Gemini | Native `streamGenerateContent` | Account-dependent; confirmation before every inference request | HTTP fixtures, native tool/signature round-trip, portable history; real-account inference unverified |

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
