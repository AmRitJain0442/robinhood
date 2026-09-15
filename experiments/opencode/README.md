# OpenCode feasibility probe

An optional, reproducible experiment behind the [runtime decision](../../docs/decisions/0001-direct-runtime.md). It is separate from Robinhood's runtime and normal CI.

## Run

From this directory, with Node 24 and Git installed:

```sh
npm ci
npm run probe
```

This installs a pinned OpenCode binary and SDK at **1.18.31**. The probe starts that local binary with isolated configuration/data paths and a loopback model endpoint. It does not inherit provider account credentials or send model inference to a remote service. Installation and engine dependency setup can access public package metadata.

The fake model requests one fixed command that appends `once` to a file in a temporary workspace. The probe verifies permission before execution, induces a quota response, observes a retry, switches models, and restarts the engine. It uses process-tree termination to clean up its own engine process.

Results are saved under the repository's ignored `.robinhood/opencode-probe.json`. Temporary fixture files are retained for inspection; their location appears in the local report. Do not commit raw local reports with machine paths or account data.

## Recorded outcome

Native Windows run on 2026-09-15:

- Permission before side effect: passed.
- Durable completed tool, manual model switch, tool-result handoff, and session restart: passed.
- Three primary-model requests were observed despite provider `maxRetries: 0`: the first produced a tool call and two later requests received HTTP 429.
- No command replay after the manual switch.
- The checked engine `auth.json` file was absent with the fixture's environment-based setup. Other possible credential persistence was not audited.

The probe expects the observed retry behavior. If an updated engine behaves differently, it should fail and prompt a fresh decision rather than silently change the evidence.
