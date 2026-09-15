# Security and local data

Robinhood is an early developer preview. Use a small repository you can inspect while the workflow matures.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/AmRitJain0442/robinhood/security/advisories/new) for credential exposure, unintended execution, data loss, or cost-policy bypasses. Include reproduction steps and synthetic examples. Do not put credentials or private source code into a public issue.

The current development branch is the only supported version. There is no stable release or response-time guarantee yet.

## Credentials and project content

- OpenRouter API keys are accepted through a hidden prompt or `OPENROUTER_API_KEY`. Robinhood does not persist them to its database. There is no OS-vault integration yet.
- Known keys are redacted from model-visible messages, saved tool results, terminal output, and exports. This is not a general-purpose scanner for every secret in source code.
- Sessions contain prompts, model responses, tool arguments/results, and workspace paths. They are local but are not encrypted by Robinhood.
- Default storage is `%LOCALAPPDATA%\Robinhood` on Windows, `~/Library/Application Support/Robinhood` on macOS, or `$XDG_DATA_HOME/robinhood` / `~/.local/share/robinhood` on Linux. `--data-dir` overrides it.
- Directories created on POSIX use restrictive modes; Windows uses inherited account permissions. Protect the containing directory and your OS account.
- Cloud inference sends conversation context and approved tool results to OpenRouter and its chosen model provider. Review their data-use terms before using sensitive code.
- Export files may contain project content. Session deletion removes application records; it does not erase prior exports, OS backups, or every underlying SQLite disk page.

## Execution boundaries

File tools resolve workspace paths, exclude common credential paths, limit content size, and check old content hashes before replacement. Every operation needs an explicit approval.

An approved shell command runs with your user privileges. These prompts are **not an OS sandbox**; commands can access files or services outside the workspace. The app imposes process/output limits and removes credential-like environment variables from tool processes, but it cannot prevent a deliberately approved command from reading files accessible to your account.

If Robinhood cannot establish whether an interrupted command finished, it stops. Inspect `/pending`, check the workspace/process state, and use `/resolve` to record the outcome you verified. Do not mark an operation complete merely to bypass the pause.

## Model access and cost

The implemented connector checks OpenRouter's catalog before each request and admits only explicit free, tool-capable routes with zero published pricing. It requests no gateway fallback and makes no implicit transport retries. Unknown pricing blocks the request.

Catalog evidence does not guarantee provider capacity, billing correctness, or compatibility with every model. The preview does not enable paid routing or implement a general free-credit balance checker. No model credentials are needed in CI.
