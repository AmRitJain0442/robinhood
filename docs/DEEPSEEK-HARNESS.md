# DeepSeek Harness integration

## Source and scope

Target: the official MIT-licensed [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), reviewed at `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` on 2026-09-16. Published runtime candidate: `@deepseek-ai/dsh@0.1.5-rc.1`. Source HEAD and published artifacts require separate verification.

The requested scope is the Harness feature set, not another DeepSeek model connector. Its plugin runtime supplies capabilities that Robinhood's current four-tool runner does not have. The proposed integration reuses the upstream runtime instead of independently reimplementing every plugin. Implementation status below starts at **audited, not integrated**.

## Capability map

| Capability | Upstream surface | Integration requirement |
| --- | --- | --- |
| Plugin composition and lifecycle | Cordis profiles, bundles, patches, plugin manager | Preserve upstream package/version ownership and explicit plugin installation |
| Agent execution and streaming | Agent loop, events, web, headless, SDK, ACP profiles | Own process lifecycle and accurately identify the active executor |
| Durable memory | Append-only sessions, resume, fork, projections, export | Define transfer into/out of Robinhood's journal; no duplicated execution |
| Context management | Compaction, tool-result pruning, session references | Keep compacted context attributable to its source |
| File tools | Read, write, edit, images, glob, grep | Use Harness's guarded execution when Harness owns the task |
| Shell and persistent terminals | Bash/PowerShell, PTYs, jobs | Preserve native platform policies and cancellation behavior |
| Planning and goals | Plan mode, tasks, goals, continuation | Expose native controls without silently creating user goals |
| Delegation | Subagents, controls, experimental agent teams | Treat child requests as model usage with the same access policy |
| Extensibility | Skills, hooks, MCP tools/resources, workflows | Installed plugins are trusted executable code |
| Web tools | Search, public HTTP fetch | Provider setup and separate service allowances may be required |
| Automation | Schedules, webhooks, background jobs | Explicit user configuration; not enabled by connecting a model |
| Interfaces | Web application, SDK, ACP; separate desktop application | Embedded runtime does not mean native terminal parity for every UI |
| Experimental tools | Browser/computer use, dynamic Cordis, programmatic tools | Optional packages, platform requirements and upstream limits still apply |

Sources: [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md), [tool catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md), [base bundle](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/README.md).

## Integration sequence

1. Pin and verify the actual runtime and its supported configuration boundary.
2. Add an authenticated loopback model gateway using Robinhood's selected connector and request access policy; support the runtime's tool schemas without substituting Robinhood's four tools.
3. Launch an isolated Harness profile with explicit workspace, no inherited provider keys, and disabled upstream session uploads/telemetry.
4. Add visible session transfer and lifecycle controls. Keep tool receipts owned by their executor; never turn imported historical calls into pending operations.
5. Exercise the actual runtime with local model fixtures, including tool execution, rejection, cancellation, persistence, and gateway access checks.
6. Document which features are available through the native runtime and which remain unverified or require optional upstream plugins.

## Boundaries found during review

- The SDK protocol currently has no approval request or mid-turn cancellation method. Closing the runtime abandons work. An SDK wrapper alone cannot promise Robinhood's existing per-tool approval interface.
- Harness's base includes session telemetry and a separate DeepSeek session-log contributor. Both require explicit configuration before carrying Robinhood context.
- The runtime is in developer preview with breaking changes; a launcher alone is not feature parity or a validated integration.
- Harness does not provide a new free token allowance. Connected model and auxiliary service limits still apply.
- Its desktop application and third-party plugin ecosystem are separate artifacts; not every upstream feature ships active in the base runtime.

Source: [SDK protocol limitations](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/README.md#known-limitations-and-deferred-work).
