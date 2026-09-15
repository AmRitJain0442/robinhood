# Robinhood

**Keep the task. Switch the model.**

A planned open-source coding terminal that connects your model providers, keeps project memory locally, and continues a session when an eligible provider runs out of quota.

> **Status: product blueprint / pre-implementation.** This repository currently contains the delivery plan and project foundation. There is no installable Robinhood runtime yet. Features and terminal examples below describe the intended product.

## The idea

You start fixing a bug with one provider. Its free allowance runs out halfway through. Robinhood checkpoints the work, selects another provider you have approved, and continues with the task, relevant context, and a record of completed commands.

You should not have to explain the project again or wonder whether the agent just ran the same command twice.

```text
ROBINHOOD   payments-service                         policy: free access

You       Fix the duplicate invoice bug and run the regression test.
Agent     Read invoice.ts. Added a guard. Regression test passed.
System    Current provider reached its request limit.
          Saved task state and completed tool results.
          Continuing with your next eligible provider.
Agent     I'll review the diff and check the remaining edge case.

Provider  Groq / selected model       Allowance: account-specific
Session   saved                      Tools: approval required
> _
```

*Illustrative interaction; no live provider calls have been tested by this project yet.*

## What we are building first

- **One terminal session:** streaming conversation, tool activity, diffs, and recovery in one place.
- **Shared project memory:** the objective, constraints, relevant files, decisions, and completed work survive provider changes.
- **Three provider integrations:** OpenRouter, Gemini API, and Groq, subject to the feasibility checks in the plan.
- **Visible allowance tracking:** requests, tokens, credits, and reset windows shown in their actual units; unknown balances stay unknown.
- **Predictable switching:** manual selection first, then automatic handoff at a verified safe boundary.
- **Local ownership:** project data on your machine, supported authentication, explicit tool permissions, and exportable sessions.

Free access belongs to your provider accounts. Robinhood will not manufacture credits or turn consumer chat access into an API entitlement. Its default routing policy will admit only configured eligible routes and stop when none remain. Provider pricing and account settings remain authoritative; see the [provider policy](docs/PROVIDERS.md).

## Build plan

| Document | Purpose |
| --- | --- |
| [End-to-end plan](docs/PLAN.md) | Scope, milestones, acceptance criteria, release process, and first implementation tasks |
| [Architecture](docs/ARCHITECTURE.md) | Runtime decision, local memory, routing, tool execution, and recovery |
| [Provider roadmap](docs/PROVIDERS.md) | Integration order, allowance semantics, authentication, and source evidence |
| [Contributing](CONTRIBUTING.md) | How to help now and what future implementation changes must demonstrate |

The first engineering milestone evaluates reusing OpenCode's supported runtime. We will choose one execution engine after that experiment. The product's core work is reliable continuity and allowance-aware routing; the [decision gate](docs/ARCHITECTURE.md#runtime-decision) defines what reuse must prove.

## Release path

1. **Prove the foundation:** engine integration, supported authentication, and Windows behavior.
2. **Complete one task:** one provider, controlled tools, persistence, and restart.
3. **Preserve work across providers:** manual switch, then safe automatic handoff.
4. **Ship a usable alpha:** onboarding, quota explanations, cancellation, and recovery.
5. **Earn a stable release:** reproducible failure tests, cross-platform packaging, and real user feedback.
6. **Expand deliberately:** more model APIs, selected official coding-agent integrations, then complementary tools.

## Contribute

The most useful contributions right now are critiques of the [runtime decision](docs/ARCHITECTURE.md#runtime-decision), reproducible provider evidence, and small improvements to the implementation plan. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

Implementation has not started, so there are no build commands or test results to advertise yet. Future releases must include a working demo and installation instructions that have been checked from a clean machine.

## License

[MIT](LICENSE). Independent community project; provider names identify planned integrations. Robinhood is the working project name and is not affiliated with the brokerage or the providers listed here.
