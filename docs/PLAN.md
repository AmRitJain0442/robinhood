# Robinhood: end-to-end delivery plan

- **Plan date:** 2026-09-15
- **Stage:** first developer preview implemented; broader release gates remain open
- **Initial maintainer:** [AmRitJain0442](https://github.com/AmRitJain0442)

## Implementation snapshot - 2026-09-16

- **M0 complete:** public repository and product foundation.
- **M1 runtime decision complete:** tested pinned OpenCode on native Windows and chose the [direct request runtime](decisions/0001-direct-runtime.md).
- **M2 preview implemented:** interactive terminal, approved tools, SQLite persistence, export/delete, and uncertain-outcome recovery.
- **Cloud API expansion implemented:** 25 connectors share the task journal. Puter is experimental; AI Horde is text-only. See the [integration ledger](INTEGRATIONS.md) for reviewed models, authentication, and validation limits.
- **Validation:** 55 local behavioral tests and the offline restart/handoff demo pass. Kilo's anonymous plain-text smoke test succeeded; a later live tool probe hit a rate limit. Other authenticated inference remains unverified.
- **Pending:** official agent bridges and browser login, account-specific allowance groups and cooldowns, automatic live fallback, long-context compaction, richer UI, real-account validation, and release hardening. Adapter implementation alone does not complete M3/M4 release gates.

The milestones below remain the end-to-end target. An implemented preview feature does not imply its beta/release gates are complete.

## 1. Product outcome

Build a terminal coding companion that keeps a task moving across the user's supported model accounts. When a provider reaches its allowance, the next eligible model receives enough verified task state to continue without repeating completed actions.

The first users are individual developers and students who already use several model providers and lose time rebuilding context between them. The first workflow is a bounded change to an existing local Git repository: understand a bug, edit files, run a test, and review the result.

**The release-defining demonstration:** a developer connects two eligible providers, starts a coding task, encounters a simulated quota failure after a tool completes, continues on the other provider, restarts Robinhood, and finishes the same task. The completed tool is not replayed, the workspace is preserved, and every provider transition has a visible reason.

### Success measures

Measure these in fixtures and small, opt-in usability sessions before claiming them publicly:

- A first-time user can connect a provider and get a streamed response within five minutes, excluding account registration and provider waiting time.
- Every documented recovery scenario either resumes from a verified boundary or pauses with an actionable explanation.
- Tests produce zero repeated completed tool executions during handoff and zero silent transitions to an ineligible paid route.
- A resumed task retains its objective, user constraints, file changes, and completed tool receipts.
- The interface reports observed usage separately from estimates and unavailable balances.
- Record prompt overhead and task completion across a small fixed set of coding tasks. Compare same-provider continuation with a provider switch; publish the method and limitations.

These are acceptance targets, not current product capabilities or claims about model quality.

## 2. Product boundaries

### Version 0.1

- One active task in one local workspace; multiple saved sessions.
- Terminal UI with streaming text, tool approvals/results, diff review, provider status, and cancellation.
- OpenRouter, Gemini API, and Groq through documented interfaces. A provider enters the release only after its selected model passes the same tool and handoff checks.
- Supported API-key connection, validation, disconnection, and a clear explanation of storage.
- Read/search files, apply a reviewed patch, and execute an approved command with bounded output and runtime.
- Persistent task state and local session resume.
- Manual provider switch; then automatic switching for eligible quota/capacity failures.
- Default free-access policy, a provider allowlist per project, and visible quota uncertainty.
- Small editable memory view and explicit session export/delete.
- Windows, macOS, and Linux support, with Windows tested from the first milestone.

### Later

- Additional verified model APIs and local inference.
- One official coding-agent integration at a time, with its own authentication and lifecycle.
- Optional search, retrieval, image, speech, and other tools when a concrete workflow needs them.
- Headless operation and structured output after interactive permissions and recovery are dependable.

### Outside this plan

Cloud accounts for Robinhood, hosted databases, team billing, a model marketplace, autonomous agent swarms, a browser IDE, and a plugin marketplace. No shared credential pool, automated account creation, consumer-session scraping, or promise of unlimited free tokens. No background git commit, push, deployment, or destructive cleanup without the user's explicit instruction.

## 3. User experience

### First run

1. Open Robinhood inside a repository. Show the workspace root and start with tool execution awaiting approval.
2. Connect a supported provider through an API-key prompt; use an official browser/device flow only where that provider documents it. Never ask for a provider password.
3. Show available eligible models, how their allowance is measured, the evidence date, and any unknown account limit.
4. Let the user choose providers allowed to receive this project's context. Save this choice locally.
5. Validate access with one disclosed, minimal request on the chosen eligible route; it consumes allowance. Do not probe every model.
6. Start a task. Additional provider setup can happen later.

### Everyday use

The main screen shows conversation and tool activity. A compact status line shows the selected provider/model, free-access policy, session save state, and a truthful allowance summary. Detailed provider and memory views are available on demand.

Planned commands, to validate during implementation:

| Command | Intended behavior |
| --- | --- |
| `/connect` | Connect or update a supported account |
| `/providers` | Inspect eligibility, cooldowns, and observed usage |
| `/switch` | Choose an eligible model; switch after active tools settle |
| `/memory` | Inspect or edit task facts and pinned project constraints |
| `/resume` | Select a saved session and reconcile the current workspace |
| `/diff` | Review changes in the active workspace |
| `/export` | Preview and export a session with credential redaction |
| `/help` | Explain commands, cancellation, and recovery |

Cancellation must stay responsive while a model streams or a subprocess runs. Standard terminal copy/paste, narrow windows, Unicode, color-disabled output, and keyboard-only use belong in the alpha. A plain output mode should use the same session logic.

### Handoff behavior

Explain what happened in one short event: why the current route stopped, whether tools finished, which route will receive context, and what was saved. Automatic routing is restricted to the user's project allowlist. If a tool outcome or route eligibility is uncertain, pause and explain the next action.

## 4. Engineering approach

Start with one TypeScript application, a local store, and a terminal UI. Prefer reuse where it passes the control and recovery requirements. [Architecture](ARCHITECTURE.md) specifies a timeboxed OpenCode experiment and the fallback decision. Implement one runtime after that gate; do not maintain both paths.

Build vertical slices that can be demonstrated. Introduce an abstraction only after two real integrations need it. Keep provider metadata and policy separate from UI rendering, and keep command execution behind one permission boundary.

## 5. Milestones and exit criteria

Estimates are focused engineering days for one experienced maintainer. They exclude provider approvals, reviewer delays, and release soak time. Re-estimate after M1; use exit criteria to decide readiness.

| Milestone | Estimate | Depends on | Deliverable |
| --- | --- | --- | --- |
| M0: repository foundation | Current change | None | Product plan, architecture, provider policy, contribution guidance, MIT license |
| M1: feasibility and runtime decision | 2-3 days | M0 | Reproducible experiment; one selected runtime and credential strategy |
| M2: one-provider vertical slice | 4-6 days | M1 | Stream, approved tools, saved task, restart |
| M3: shared context across three providers | 3-5 days | M2 | Manual switch with verified context and capability matching |
| M4: allowances and automatic handoff | 4-6 days | M3 | Routing policy, usage ledger, fault-tested recovery |
| M5: alpha experience | 3-5 days | M4 | Onboarding, memory/status views, cancellation, documentation |
| M6: beta and v0.1 release | 3-5 days plus soak | M5 | Cross-platform packages, release checks, reproducible demo |
| M7: targeted expansion | Per integration | v0.1 | Additional providers and official agent sessions |

**Initial planning range:** 19-30 focused engineering days after M0. M1 may expose constraints that change scope or estimates; publish that decision before adding runtime features.

### M1: prove what the engine can actually do

- Pin an OpenCode runtime/SDK version and use its supported API in a disposable fixture repository.
- Demonstrate per-turn model selection, streamed events, permission handling, cancellation, and session export/reload.
- Inject a model failure after a tool completes. Identify a durable completion receipt and a safe continuation boundary.
- Inventory every model call the engine can make, including summaries, titles, retries, and fallback models. Prove those calls obey the selected policy, or disable the feature.
- Prove the application can enforce its workspace/tool permissions and prevent repository configuration from enabling unapproved plugins, commands, or model routes.
- Test credential handling without a silent plaintext copy. OpenCode's documented default credential file is a specific issue to resolve, not an assumed secure vault.
- Run the experiment on native Windows, including paths with spaces, child-process shutdown, and runtime installation. Check local database packaging on all target operating systems.
- Verify current free-route eligibility and tool support for one selected model on each launch provider. Optional live probes require maintainer-owned credentials; fixture tests remain independent of accounts.

**Exit:** commit a short decision record, the reproducible experiment, pinned dependencies, and one chosen runtime. If a critical boundary cannot be enforced through supported APIs in the timebox, choose a small direct API loop and adjust estimates. Do not fork an entire coding agent to avoid making this decision.

### M2: complete and resume one task

- Add the package, TypeScript checks, basic terminal entry point, and fixture-based CI when runtime code begins.
- Connect the first provider, stream its response, and handle invalid credentials and cancellation.
- Implement/read through the selected engine's controlled read, search, patch, and command tools.
- Persist the task, provider choice, messages, permission decisions, tool receipts, and workspace identity.
- On restart, reopen the session and verify the workspace before offering continuation.

**Exit:** from a clean fixture repo, make a small change, run an approved test, restart, and correctly report what already happened. An interrupted command with an unconfirmed result pauses for reconciliation.

### M3: make context portable

- Integrate the other two launch providers using the same acceptance fixtures.
- Define a small capability record: tools, streaming, context size, and supported input types.
- Create a bounded handoff packet from task facts, recent messages, file references, and tool receipts.
- Translate tool-call/result formats without leaking provider-specific internal reasoning or assuming tokenizers are interchangeable.
- Add manual switching at a safe boundary and recheck edited files before continuing.

**Exit:** a three-provider task preserves user constraints and file changes. A smaller-context model either receives a valid compacted packet or is rejected with a useful explanation. Unsupported tool models cannot be selected for an active coding loop.

### M4: route using evidence and recover predictably

- Record usage in each provider's native units, with quota scope, evidence quality, and reset window.
- Enforce project allowlists and free-access eligibility before every model request, including internal summarization.
- Implement deterministic provider priority, cooldowns, bounded retries, and rate-limit handling.
- Add automatic switching only after the active execution state is settled and checkpointed.
- Explain when a published limit is known but remaining account balance is unavailable.
- Stop cleanly when all eligible routes are exhausted; preserve the task and show the next known reset or reconnect action.

**Exit:** all failure scenarios in section 6 pass. Multiple models backed by a shared pool do not produce a fictitious multiplied allowance. A stale price record never silently authorizes a newly paid route.

### M5: make the alpha pleasant to use

- Build onboarding and the status, provider, memory, diff, and saved-session views.
- Provide specific errors for credentials, quota, outage, unsupported context, and tool failures.
- Add context disclosure, session export preview, deletion, and credential disconnection.
- Test with at least five volunteer developers using small non-sensitive repositories; gather feedback without collecting their source code or credentials.
- Document an install path, a five-minute tutorial, troubleshooting, and known limitations.

**Exit:** volunteers can complete the main workflow without maintainer intervention; severe recovery and permission issues are resolved before widening the alpha.

### M6: release v0.1

- Test clean installs and upgrades on native Windows, macOS, and Linux; verify terminal and plain-output behavior.
- Check package/binary name availability and settle the working name before publishing. Build versioned artifacts from the tagged commit.
- Run type/lint checks, behavioral tests, dependency/license checks, and the cross-platform smoke matrix. Live provider checks remain opt-in and cannot consume paid CI credentials by default.
- Validate database migrations with a backup and recovery path; refuse an incompatible downgrade rather than corrupting sessions.
- Publish a reproducible demo, changelog, supported-version matrix, provider verification dates, and known limits. Label simulated quota failures in demos.
- Configure private security reporting before accepting runtime users; document that channel. Keep releases recoverable by retaining previous artifacts and migration guidance.
- Use a two-week beta feedback window as a planning target. Release when the gates pass, not merely when the window ends.

**Exit:** a clean-machine user can install, connect two providers, complete the handoff demonstration, restart, inspect usage, and remove their local session/account data using documented steps.

### M7: expand without diluting the core

Take one provider family at a time from [PROVIDERS.md](PROVIDERS.md). Select based on a usable documented interface, recurring access or clearly bounded credits, contributor demand, and passing behavior tests.

Treat an official coding agent as an agent session with its own tools and lifecycle. Begin with explicit handoff and visible permission boundaries. Async repository services remain separate jobs. Add search/media tools only after the main coding workflow has a demonstrated need.

## 6. Required behavioral checks

| Scenario | Required result |
| --- | --- |
| Rate limit before any output | Honor cooldown; switch only to an eligible route |
| Rate limit after partial assistant output | Preserve the incomplete record; continue from the last verified boundary |
| Provider failure after a completed command | Retain its receipt; do not execute that command again as automatic recovery |
| Crash after launching a command but before saving its result | Mark outcome unknown; reconcile before further side effects |
| User cancels during a command | Stop the process tree where supported; report any unconfirmed termination |
| All providers exhausted | Save and pause; show known reset information without repeated probing |
| Model route becomes paid or eligibility cannot be established | Block the route under free-access policy |
| Several models share an account quota | Debit/report one shared group; do not sum the same pool |
| Context shrinks on provider switch | Compact with provenance or decline the route; retain full source history |
| Files change outside Robinhood | Detect stale file references and patch conflicts; re-read before writing |
| Tool output contains instructions or secrets | Treat output as data; permissions stay external to the model; apply credential redaction |
| Windows junction or symlink escapes the workspace | Recheck resolved paths at the tool boundary |
| Restart with a different checkout or renamed directory | Request workspace reconciliation; do not assume path equality proves identity |
| Export or deletion | Preview exported context, exclude credentials, and account for engine-owned storage |

Use fake provider streams and disposable repositories for repeatable failure tests. Run a small opt-in live suite for interface drift; record date, model, and observed account tier without committing secrets. Avoid spending provider quota to run ordinary pull-request checks.

## 7. Risks and how we contain them

| Risk | Response |
| --- | --- |
| Free offers disappear or vary by region/account | Keep dated evidence and account-specific state; make provider maintenance cheap; pause when no route qualifies |
| Reused engine hides retries or tool lifecycle | Resolve in M1; select the direct loop if mandatory controls cannot be enforced |
| A summary loses an important constraint | Keep pinned user facts and source references; retain the original transcript; test handoff quality |
| A crash makes command outcome ambiguous | Durable journal plus explicit reconciliation; do not promise exactly-once shell execution |
| Smaller free models struggle with agent tasks | Capability and quality checks per model; expose limitations; allow an explicit manual choice |
| Data goes to an unintended provider | Project allowlist checked on each route, including gateways and helper calls |
| Credential storage differs between engines | Explicit storage design and tests; session-only connection when secure persistence is unavailable |
| Too many integrations consume all maintenance time | Three providers at launch; add one tested integration at a time |

## 8. Open-source operating model

- Keep the default branch reviewable and runnable once code exists. Use small PRs with behavior and validation described.
- Maintain one active milestone. Use GitHub issues for concrete slices, not a second copy of this entire plan.
- Label provider evidence separately from verified runtime support. Close obsolete offers with their retirement evidence.
- Require a maintainer review for changes to routing eligibility, credential handling, command execution, and migrations.
- Keep a contributor guide, adapter example, architecture notes, and release checklist current as code lands.
- Prioritize broken sessions, accidental cost exposure, data loss, and permission failures ahead of provider count or visual polish.
- Use local diagnostics by default. Any future telemetry requires a separate documented, opt-in design.

## 9. First implementation queue

1. **Runtime feasibility harness:** one pinned OpenCode instance, local fixture repo, injected model failure, event capture, cancellation, and restart.
2. **Credential and policy proof:** document actual persistence, isolate untrusted configuration, and prove every model call is policy-bound.
3. **Runtime decision record:** choose the single execution path and update this plan from measurements.
4. **One-provider session:** streaming UI, durable state, approved tools, and restart acceptance test.
5. **Portable task checkpoint:** explicit user facts, workspace references, tool receipts, and context budgeting.
6. **Three-provider manual switch:** selected models, capability checks, and a reproducible handoff example.
7. **Quota-driven continuation:** native-unit ledger, deterministic routing, cooldowns, and failure-injection tests.

Items 1-3 now have an experiment and a recorded decision. The initial portions of items 4-5 are implemented in the developer preview. Next: real-account OpenRouter verification, Gemini/Groq eligibility and adapters, then shared quota/cooldown handling before enabling automatic live-provider handoff.
