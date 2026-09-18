# Terminal and local GUI

Both interfaces use the same session engine, provider connectors, permission policy, and SQLite journal.

```sh
robinhood       # terminal
robinhood gui   # local browser interface
```

Both accept `--workspace PATH`, `--data-dir PATH`, `--session ID`, and `--ask`. The browser launch prints a private localhost URL if automatic opening fails. Keep the launching process running.

From an existing terminal, use `/gui` to open the browser on **that same live session**. Inputs in either interface answer the current shared prompt. Stale browser submissions are rejected. Do not launch two independent processes against the same database; its existing ownership lock prevents that.

## GUI views

- **Workspace:** live conversation, task input, stop button, provider/model pickers, active route, permission mode, and recent tool receipts. Browser prompts also handle approvals and credentials without echoing the credential into the conversation.
- **Usage & tokens:** cumulative reported input/output tokens, request and failure counts, model breakdown, recent daily totals in UTC, workspace/all-workspace filtering, and JSON export.
- **Accounts:** search providers, filter connected accounts or automatic free-route providers, connect/disconnect, select models, and inspect recorded provider usage. Each provider currently has one linked profile. Robinhood does not infer an account email or organization from an API key.
- **Task history:** search and resume the latest 100 saved tasks for the current workspace.
- **Settings:** Forest/Paper themes, comfortable/compact density, task inspector visibility, YOLO/ask permissions, automatic routing, and plan mode. Display preferences are stored in the browser for that local address.

Ctrl+Enter sends a browser message. Account and model choices are searchable. Close the tab to leave the engine running; `/quit` exits it. Native Google/GitHub CLI sign-in still uses its existing terminal login command when needed.

## Terminal improvements

- Cumulative reported-token and request totals; `/usage` prints the detailed ledger.
- The route label updates during automatic handoffs.
- Up/Down recalls this process's previous task inputs; credentials are excluded from that history.
- Tab completes suggested slash commands.
- Home/End or Ctrl+A/Ctrl+E moves within input; Ctrl+U clears it.
- Ctrl+B toggles the details panel on sufficiently wide and tall terminals.
- Page Up/Page Down scrolls the transcript; Ctrl+C cancels active work.

## What tracking means

Totals aggregate provider-reported usage events from **saved sessions**, including earlier terminal sessions. New events carry explicit provider/model attribution; older events use the route recorded at that point. Forking a conversation does not duplicate its usage. Compaction usage is counted even when a proposed summary is rejected.

Some providers and native CLIs omit token usage; failures may consume tokens without returning a usage report. Missing reports are not treated as known zero consumption. Counts are not a provider billing statement. Costs, free-credit balances, reset times, and remaining allowances stay **unknown** unless actually available; this interface does not invent them. Deleting a saved session also deletes its usage events.

Account cards aggregate activity by provider, not by historical credential identity. If you replace a provider's credential, its existing provider totals remain combined. Multi-profile account attribution and provider balance synchronization are not implemented.

## Local access

The GUI binds only to `127.0.0.1` on a random port. Its controls and data require a random bearer token carried in the launch URL fragment, then kept in the tab's session storage. The server validates Host and Origin, disables caching, and sets a restrictive content policy. Treat the launch URL as private: anyone with it and access to this local machine can control the active Robinhood session. No extra remote service or telemetry is introduced.

Browser rendering uses text nodes for model output and provider labels. The token is not embedded in the public HTML. API credentials are supplied only through the existing credential prompt and OS-vault workflow.
