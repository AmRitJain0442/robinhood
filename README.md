# Robinhood

**Keep the task. Switch the model.**

A local coding terminal with durable task memory, explicit tool approvals, and model routing built around the free access you actually have.

> **Developer preview — 0.0.1.** There are 25 cloud API connectors and four native CLI bridges: OpenCode, Kilo, Gemini, and GitHub Copilot. Native Google/GitHub login is supported; authenticated inference remains unverified. OpenCode and the direct Kilo API passed anonymous text smoke tests. Automatic live-provider switching is pending. See the [integration ledger](docs/INTEGRATIONS.md).

## Try the handoff demo

Requires **Node.js 24.13 or later in the Node 24 series**, npm, and Git.

```sh
git clone https://github.com/AmRitJain0442/robinhood.git
cd robinhood
npm ci
npm run demo
```

The demo creates a disposable workspace and uses **two simulated providers**. It runs one fixed command, injects a quota error, passes the saved tool result to the backup, and reopens the session from SQLite. It needs no account or model tokens. The command is automatically approved only because it is the exact fixed fixture command inside the demo's temporary workspace.

```text
Approved the fixed demo command in its disposable workspace.
run_command: completed. Receipt … saved.
Provider request limit reached. Saved state; switching to simulated-backup.
The saved command receipt is in context. The command ran once; I will not repeat it.
PASS: quota handoff preserved the tool result; one command execution; session reopened from SQLite.
```

## Use the terminal

Install the command once from your Robinhood checkout:

```sh
npm run build
npm link
```

Then open a terminal in any project and run:

```sh
robinhood
```

Robinhood uses your current directory as the workspace. You can also run `robinhood --workspace /path/to/project`, `robinhood --help`, or `robinhood demo`. The local installation points to this checkout; run `npm run build` here after pulling updates. Remove the command with `npm uninstall -g @amritjain0442/robinhood`.

Inside the terminal:

**Want OpenCode's free models without an API key?** Run `/connect opencode`, choose **Launch OpenCode free-model bridge**, then `/models opencode`. Robinhood launches the real OpenCode CLI engine in the background while keeping its own UI, memory, and approvals. [How the bridge works and its limits](docs/OPENCODE.md).

**More native CLI engines:**

| Engine | One-time setup in your terminal | Inside Robinhood |
| --- | --- | --- |
| Kilo CLI | No login required | `/connect kilo-cli` |
| Gemini CLI | `robinhood login gemini-cli` | `/connect gemini-cli` |
| GitHub Copilot CLI | `robinhood login copilot-cli` | `/connect copilot-cli` |

Then use `/models PROVIDER`. These run the actual pinned CLIs behind Robinhood's memory and approvals. Gemini and Copilot use their own account allowances; Copilot may consume paid credits. All four native executables pass local protocol fixtures. Kilo CLI live probes returned an empty response or quota error; Google/GitHub inference requires account validation. [Setup and validation details](docs/CLI-BRIDGES.md).

1. Run `/connect` (or `/accounts`) to search 25 API connectors and four CLI bridges. OpenRouter supports browser authorization; Puter has an experimental browser login. Choose Google on the provider's sign-in page if offered. Kilo and AI Horde also offer anonymous access.
2. For other providers, choose **Open official account setup**, sign in on their site, and paste an API credential once. Credentials are saved in your OS vault and restored on launch. If the vault is unavailable, the connection lasts for the current process only. Environment credentials take precedence.
3. Run `/models` to search and select a model, or `/use PROVIDER MODEL_ID` to switch directly. Task memory stays in the session.
4. Describe a task. Review and approve each requested tool operation. Use Page Up / Page Down to inspect longer output; Ctrl+C cancels active work.
5. Use `/sessions` and `/resume ID` to recover a task after restarting. Saved accounts reconnect; choose a model with `/models`.

**One terminal, separately authorized accounts.** Google sign-in to one provider cannot authorize unrelated providers. Robinhood does not pool or transfer credits, create accounts automatically, bypass quotas, or treat consumer subscriptions as API allowances. See [account linking](docs/ACCOUNTS.md) for supported methods and limitations.

OpenRouter pricing is checked before every request; only explicit zero-priced `:free` routes qualify automatically. Other connectors may have account-dependent free tiers or credits. Those require explicit confirmation for each request and are not counted as verified free access. See the [access policy](docs/INTEGRATIONS.md#free-access-versus-account-dependent-access).

Your conversation and approved tool results are sent to the selected provider and any upstream service it uses. Local session storage does not make cloud inference private.

## What works today

| Area | Implemented behavior |
| --- | --- |
| Terminal | Full-screen interface, responsive account/status panel, searchable account and model pickers, streaming replies, and scrollable history |
| Accounts | OpenRouter browser authorization, experimental Puter browser login, anonymous Kilo/Horde, and OS-vault credential persistence |
| Provider connectors | See the [integration ledger](docs/INTEGRATIONS.md) for protocols, access gates, and validation status |
| OpenCode CLI | Optional local engine bridge for advertised free models; anonymous Big Pickle live smoke passed |
| Memory | SQLite conversation, objective, usage observations, and durable tool receipts |
| Tools | List a directory, read a file, create/replace a file with a hash check, and run a bounded approved command |
| Recovery | Known completed tools stay completed; uncertain crash outcomes block continuation until reconciled |
| Agent capabilities | Planning, checklists, explicit goals, session branches, reviewed compaction, pinned constraints, skills, plugins, MCP, background jobs, persistent shells, research delegation and workflows |
| Portability | Source installation; automated tests configured for Windows, macOS, and Linux |
| Handoff | Tested with simulated providers; automatic live-provider fallback is pending |

The quota display reports observed activity and unknown balances honestly. This preview does not calculate a universal daily token pool or automatically compact long sessions. Model-specific compatibility still needs real-account verification.

## Agent features

Robinhood now has **21 built-in tools** and a native terminal implementation of core [DeepSeek Harness-inspired features](docs/DEEPSEEK-HARNESS.md). This is not full upstream parity; the linked checklist lists remaining features.

Use `/plan on` to inspect before editing, `/todos` for the checklist, `/pin TEXT` for durable constraints, `/fork` to branch, and `/compact` to review a shorter context summary. `/skills`, `/plugin FILE`, and `/mcp CONFIG.json` extend the agent. `/delegate TASK` runs a read-only research branch; `/workflow FILE` runs a reviewed sequence of tasks. `/jobs` and `/terminals` show background work. `/capabilities` lists the active tools.

The [system prompt](prompts/system.md) is adapted from your supplied prompt collection, with persistence, implementation and verification guidance. `/prompt` shows the active version. The full source collection is preserved as a reference; incompatible templates and unavailable-tool descriptions are not sent to models.

## Useful commands

| Command | Purpose |
| --- | --- |
| `/models PROVIDER`, `/use PROVIDER MODEL` | Discover models and switch providers without resetting the task |
| `/providers`, `/status` | Inspect connection and locally observed activity |
| `/memory` | Inspect the saved objective and conversation |
| `/sessions`, `/resume ID`, `/new` | Manage tasks |
| `/continue` | Continue from saved state |
| `/pending`, `/resolve ID NOTE` | Reconcile an uncertain tool outcome after checking what happened |
| `/reconcile` | Accept a changed checkout after reviewing the workspace |
| `/export PATH`, `/delete` | Export or delete a saved session |
| `/disconnect`, `/quit`, `/help` | Disconnect, exit, or show all commands |

Approved commands run with your OS privileges; permission prompts are not a sandbox. Credential paths are excluded from file tools, but arbitrary approved shell commands still have normal filesystem access. See [security and local data](SECURITY.md).

## Development

```sh
npm ci
npm run check
```

The suite covers HTTP streaming, changing prices, rate-limit handling, permission denial, file conflicts, path escapes, process cancellation, secret redaction, and a real process crash after a side effect but before saving its receipt. Ordinary tests use local fixtures and never require model credentials.

The optional [OpenCode feasibility experiment](experiments/opencode/README.md) has separate dependencies and is not used by the application. The experiment informed the [runtime decision](docs/decisions/0001-direct-runtime.md).

## Roadmap

1. Verify the OpenRouter connector against real accounts and selected models.
2. Expand the provider ledger one integration at a time, with allowance evidence and the same recovery checks.
3. Add quota grouping, cooldowns, project provider policies, and automatic handoffs between eligible live providers.
4. Improve context budgeting, editable memory, terminal navigation, and onboarding.
5. Ship a verified cross-platform release, then add official coding-agent integrations and complementary tools.

| Document | Purpose |
| --- | --- |
| [End-to-end plan](docs/PLAN.md) | Milestones, scope, acceptance criteria, and release gates |
| [Architecture](docs/ARCHITECTURE.md) | Runtime, persistence, routing, and tool boundaries |
| [Provider roadmap](docs/PROVIDERS.md) | Integration order and allowance semantics |
| [Contributing](CONTRIBUTING.md) | Development workflow and provider evidence requirements |

## License

[MIT](LICENSE). Independent community project. Robinhood is the working project name and is not affiliated with the brokerage or the providers listed here.
