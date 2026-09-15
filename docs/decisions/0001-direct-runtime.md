# 0001: own the model-request and tool-receipt boundaries

- **Date:** 2026-09-15
- **Decision:** use one small direct API runtime for the initial application.
- **Evidence:** OpenCode 1.18.31 / SDK 1.18.31, tested on native Windows with Node 24.13.1.

## Experiment

The [reproducible probe](../../experiments/opencode/README.md) starts an isolated OpenCode server in a temporary workspace with spaces in its path. A loopback endpoint supplies one tool call, then HTTP 429 responses. The probe approves the tool, aborts the retrying turn, switches models, and restarts the server.

Observed results:

| Check | Result |
| --- | --- |
| Approval arrives before the command writes its receipt file | Passed |
| A completed tool is visible through the session message API | Passed |
| Manual model switch includes the completed tool result | Passed |
| Command executes once across the manual switch | Passed |
| Session history survives engine restart | Passed |
| Environment-supplied fixture credentials create the expected `auth.json` file | No file at the checked location; this is not a complete storage audit |
| Setting provider `maxRetries: 0` prevents engine-level retries | **Failed:** the endpoint received the initial tool-generating request plus two subsequent requests before cancellation |

The pinned source explains the last result: the session retry layer has its own retry policy, separate from the language-model request's retry option. [Session retry source](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/session/retry.ts), [language-model request source](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/session/llm.ts).

## Why choose a direct runtime

OpenCode demonstrated useful session and tool behavior. Robinhood additionally needs an application-controlled eligibility check immediately before each request and a durable operation record before each side effect. A wrapper would need further hooks or a policy proxy, plus coordination with another session store. The experiment did not establish those guarantees through the simple integration being evaluated.

For the first release, a direct request path and a local execution journal are easier to inspect and test. This is a product-fit decision, not a claim that OpenCode is unsafe or incapable of further customization.

## Implementation scope

- One TypeScript application; no runtime selection framework.
- OpenRouter first, with current catalog checks and no transport retries. The other launch providers remain pending.
- A small HTTP adapter using the maintained `eventsource-parser` package for stream framing. No custom SSE framing parser or full agent framework.
- SQLite via pinned `better-sqlite3`; native Windows installation and behavioral tests passed locally. CI supplies the remaining OS checks.
- Explicit per-operation approval, transactional receipts, and an unknown-outcome recovery state.
- API keys supplied by a hidden terminal prompt or environment variable; process-only credentials. OS vault persistence is deferred.
- Plain interactive terminal first. A richer Ink UI can follow once the core workflow is validated.

## Limits of this decision

The probe uses simulated model responses. It does not establish real model quality, free-account eligibility, project-plugin isolation, every engine helper call, or all credential-storage behavior. Those untested engine gates are no longer prerequisites for the selected direct runtime; the application has its own tests and does not load OpenCode configuration.

Real-account inference, Gemini/Groq integration, cross-provider quota grouping, and beta usability remain release gates. The offline demo is not evidence that live multi-provider integration is complete.
