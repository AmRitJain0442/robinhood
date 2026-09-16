# Harness features in Robinhood's terminal

> Permission mode: the terminal now defaults to YOLO, which satisfies runtime approval gates without prompting. `--ask` or `/permissions ask` restores per-action confirmations. References below to approval describe the execution gate; interactive confirmation applies in ask mode. Account-dependent requests may consume credits. Plan mode and uncertain-outcome checks remain enforced.


The official MIT-licensed [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is the feature reference, reviewed at `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` on 2026-09-16. Per the user's chosen direction, features are implemented in Robinhood's TypeScript runtime and terminal. DeepSeek Harness is **not** an installed dependency, embedded web application, or additional token provider.

## Implemented

| Area | Native Robinhood behavior |
| --- | --- |
| Agent prompt | User-supplied base template adapted in `prompts/system.md`; `/prompt` displays it; requests record its SHA-256 |
| Tool catalog | 21 built-in tools plus explicitly loaded extensions; per-request catalogs reach API adapters and CLI bridges |
| Workspace tools | Listing, reading, globbing, literal search, hash-checked writes and unique literal edits |
| Planning | `/plan on` restricts offered and executable tools; `/plan off` restores approved execution |
| Tasks and goals | Durable checklist via model tools and `/todos`; `/goal TEXT` explicitly creates a goal; completion requires approval |
| Questions | `ask_user` collects a terminal response |
| Branching | `/fork [OBJECTIVE]` copies history and completed receipts; pending work blocks branching |
| Context | `/compact` requests a summary for review; full history and receipts remain saved |
| Pinned memory | `/pin`, `/pins`, `/unpin`; constraints survive compaction and branching |
| Session search | `/search TEXT` searches objectives and conversation text within the current workspace |
| Skills | `/skills` discovers `.agents/skills/*/SKILL.md`; `/skill NAME` activates one skill per session |
| Project guidance | `/instructions` explicitly loads root `AGENTS.md`; nested discovery is not automatic |
| Plugins | `/plugin FILE.mjs` loads a trusted local tool plugin; `/extensions` and `/unload NAME` manage it |
| MCP | `/mcp CONFIG.json` connects stdio or HTTPS Streamable HTTP; tools, resource listing/templates and reads use approvals |
| Background jobs | `job_start`, `job_list`, `job_stop`; `/jobs`, `/job-stop ID`, `/job-resolve ID NOTE` |
| Persistent shells | Five terminal tools; `/terminals`, `/terminal-close ID`, `/terminal-resolve ID NOTE`; PowerShell on Windows, Bash elsewhere |
| Delegation | `/delegate TASK` runs one read-only research branch on the selected model and imports its report |
| Web retrieval | `web_fetch` retrieves bounded public text pages with checked/pinned DNS and redirect validation |
| Workflows | `/workflow FILE.json` reviews and executes prompt steps; `/workflow-resume` continues saved progress |
| TUI | Plan/execution indicator, checklist progress and worker count; `/capabilities` displays available tools |

These are native features, not full upstream parity. Cordis packages cannot be loaded as Robinhood plugins unchanged.

## Quick start

Start `robinhood`, connect/select a model, then:

```text
/plan on
/pin Preserve the public API and existing tests.
Inspect this repository and create a checklist for the feature.
/todos
/plan off
Implement the reviewed plan.
/fork Explore a different approach
/compact
```

### Local plugin

Save as a trusted `example.mjs`, then `/plugin /absolute/path/example.mjs`:

```js
export default {
  name: 'example',
  tools: [{
    name: 'echo',
    description: 'Return the supplied text.',
    inputSchema: {
      type: 'object', properties: { text: { type: 'string' } },
      required: ['text'], additionalProperties: false,
    },
    async execute(args, context, signal) {
      signal.throwIfAborted();
      if (typeof args.text !== 'string') throw new Error('text is required');
      return args.text;
    },
  }],
};
```

The model sees `example__echo`. `context` includes Store and session. Plugins are trusted JavaScript with OS privileges; module initialization and plugin internals are not sandboxed. Authors validate arguments and honor cancellation. An execution exception or invalid/oversized result produces an **unknown** outcome requiring inspection. Plugins may export asynchronous `close()` for cleanup.

### MCP

```json
{
  "name": "myserver",
  "command": "node",
  "args": ["/absolute/path/server.js"]
}
```

Alternatively use `{ "name": "myserver", "url": "https://your-server.example/mcp" }`. Only explicitly trusted configurations launch. Environment API keys are not copied into configuration. Remote OAuth, custom authentication headers, sampling, server-initiated elicitation and MCP prompts are not implemented. Servers and plugins do not autostart. Catalogs are captured at connection time; reconnect to refresh them. Extension tools are blocked in plan mode regardless of server read-only annotations.

### Workflows

Use [the example workflow](../examples/review-workflow.json) with `/workflow FILE`. Each step uses the current route and account/tool approvals. Resume pauses with `/workflow-resume`. A final assistant reply ends a step; it is not independent proof of task success. Review receipts and results. Workflows run in the foreground.

## Execution and memory limits

- Jobs: four active, ten-minute lifetime, 32 KiB output. Terminals: four active shells, ten-minute lifetime, bounded snapshots and 1 MiB total output. Both close on normal exit. Crashes can leave processes alive: inspect saved IDs before reconciliation. Nothing automatically reattaches or reruns.
- Terminal input receipts mean input was sent, not that a command completed. Read output and verify results before dependent work.
- Unknown outcomes block model turns. Active/unknown jobs and terminals block compaction, branching and deletion. Closing a shell does not undo its commands.
- File tools exclude known credential paths and workspace escapes. Approved commands, PTYs and plugins retain OS privileges.
- Compaction requires review and retains an operation ledger. Summaries can omit details; full history remains. Very large histories can exceed the single-summary request budget.
- The default prompt takes about 12 KB before history/tools. Horde uses a shorter text-only adaptation to preserve its 8 KiB budget; other unusually small-context routes may still reject the default. The preserved 339 KB original collection is never sent wholesale.
- Account-dependent requests require confirmation, including delegation, workflows and compaction. These features create no additional free credits.

## Still unimplemented

Full parity remains open:

- Concurrent agent teams, shared task boards/mailboxes, model-selected delegation and writable delegated agents.
- Schedules, inbound webhooks, unattended work across restarts and automatic goal continuation.
- Image attachments/read-image, visual deliverable cards, built-in browser/computer control and provider-backed web search. MCP servers can provide tools, but specific browser/computer integrations are unverified.
- Cordis compatibility, live reload, scoped capability realms, upstream hook formats and programmatic tool execution.
- ACP/SDK server interfaces, desktop/web applications, LSP backends and remote OS sandboxes.
- Automatic compaction, semantic search, multiple active skills and nested instruction discovery.

References: [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md), [tool catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md), [base bundle](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/README.md). Persistent shells use [node-pty](https://github.com/microsoft/node-pty).

## Validation

The local suite covers native executable model bridges, actual MCP stdio calls, real persistent PowerShell state, plan-mode enforcement, literal edit conflicts, unknown outcome recovery, context preservation, workflow interruption and public-address rejection. A real TUI smoke check exercised launch, planning, pinning, capability inspection and exit. The Darwin PTY helper applies a narrowly scoped executable-bit repair for [node-pty issue 850](https://github.com/microsoft/node-pty/issues/850); macOS and Linux CI passed that fix. Real-account provider and remote MCP inference remain subject to their separate validation limits.
