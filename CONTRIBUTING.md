# Contributing to Robinhood

Robinhood is an early TypeScript terminal application. Start with the [plan](docs/PLAN.md), [architecture](docs/ARCHITECTURE.md), and [runtime decision](docs/decisions/0001-direct-runtime.md). Implemented connectors and remaining verification are tracked in the [integration ledger](docs/INTEGRATIONS.md).

## Development

Use Node 24.13 or newer in the Node 24 series:

```sh
npm ci
npm run check
npm run demo
```

Normal tests and the demo use local fixtures, require no credentials, and do not consume model quota. The demo retains its temporary workspace for inspection. The optional OpenCode experiment has its own package and instructions under [experiments/opencode](experiments/opencode/README.md).

## Useful contributions now

- Verify an implemented provider/model against a real account using a small, non-sensitive task, and document the actual result.
- Improve an acceptance criterion with a concrete failure case.
- Supply dated official evidence for a provider's interface, allowance, or retirement.
- Find an ambiguity in memory ownership, tool recovery, account eligibility, or the user experience.

For a large change, open an issue describing the user problem, proposed scope, and how success would be demonstrated. Small documentation fixes can go directly to a pull request. Keep changes focused and avoid introducing infrastructure before an implementation needs it.

## Pull requests

Explain what changes, why it matters, and how it was checked. Distinguish proposed behavior from working behavior. Do not claim a provider is supported just because its endpoint resembles another provider's API.

For documentation, verify local links, current official sources for provider claims, and clear status labels. Distinguish local HTTP fixture coverage from real-account inference and model-quality checks.

Every code PR should pass `npm run check`. Recovery, routing, permissions, and persistence changes need meaningful behavioral tests. Normal CI must use fixtures and must not require a contributor's model credentials or paid API calls.

For a provider integration, follow the [acceptance checklist](docs/PROVIDERS.md#acceptance-checklist-for-a-provider). Add one integration at a time and include failure behavior, not just a successful completion.

## Secrets and session data

Never commit credentials, auth files, private code from a session, or raw account exports. Use synthetic fixtures and inspect logs before attaching them to an issue. Known-secret redaction is a useful safeguard, not proof that arbitrary session content is safe to publish.

The local `research/` directory is intentionally ignored: exploratory archives are not automatically part of the public repository. Curated provider evidence belongs in the documentation with dates and official sources.

## Project decisions

The maintainer keeps the current milestone small and reviews changes to cost eligibility, credentials, tool execution, and migrations. Record a consequential architecture decision with its evidence; ordinary implementation choices do not need a new process or committee.

Be respectful, precise, and willing to revise an idea after a reproducible result. Contributions are made under the repository's [MIT license](LICENSE).
