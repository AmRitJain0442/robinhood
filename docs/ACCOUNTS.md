# One terminal, your accounts

Run `robinhood`, then `/connect`. Search the 25 cloud API connectors and the OpenCode CLI bridge, choose a connection method, and use `/models` to select a route. `/accounts` opens the same manager. `/disconnect PROVIDER` removes the local connection and its saved credential or anonymous connection marker.

## Supported methods

| Providers | Connection method |
| --- | --- |
| OpenCode CLI bridge | Launch the isolated local engine; no credential required; [details](OPENCODE.md) |
| OpenRouter | Browser authorization with S256 PKCE; API credential fallback |
| Puter | Experimental browser authme flow; auth-token fallback |
| Kilo, AI Horde | Anonymous access, or an account API credential |
| Gemini, Groq, Mistral, Inception, Cerebras, SambaNova, Z.ai, OpenCode Zen, Cline API, Vercel, Hugging Face, NVIDIA, Fireworks, Scaleway, Sarvam, Poolside, Alibaba, Ollama Cloud, Cohere, Cloudflare, AI21 | Official setup link and one-time API credential entry |

Cloudflare also needs its account ID. All 25 connectors can restore credentials from the OS vault. Environment values take precedence. Accounts are shared across this OS user's Robinhood workspaces; session data directories do not isolate account credentials.

Provider browser login may offer Google, but **a Google session is not a universal API grant**. You authorize each provider separately. Browser cookies, consumer subscriptions, and free credits cannot be copied into a universal token pool. Provider onboarding, availability, geography, verification, and account eligibility still apply. Robinhood does not register accounts or accept provider terms for you.

## Persistence and recovery

- Credentials use Windows Credential Manager, macOS Keychain, or Linux Secret Service. No plaintext file fallback. If the vault is unavailable or rejects a credential, the current connection remains usable until exit; an older saved credential may remain unchanged.
- Browser sign-in has a three-minute deadline. Ctrl+C cancels; cancellation or a failed exchange preserves the existing connection. A displayed authorization URL lets you open the flow manually when automatic browser launch fails. The browser must be able to reach the same machine's loopback listener; remote/headless terminals can use credential entry instead.
- `/disconnect` removes local authorization, not the provider's remote key. Revoke keys on the provider website when needed. Remove environment variables separately.
- A restored credential is not proof it remains valid. Expired or revoked credentials require reconnecting; model requests surface provider errors. There are no blind retries, quota bypasses, or silent paid fallbacks.
- Model selection remains explicit after restart. Saved task history is independent of account credentials.

## Terminal controls

Type to filter account and model menus; use arrow keys and Enter to choose, Escape to cancel. Credentials stay hidden. Page Up / Page Down scroll the transcript, including approval details. Ctrl+C cancels active inference or browser sign-in; at an ordinary prompt it exits. Wider terminals show workspace, model, account count, and session status in a side panel. The original terminal screen returns on exit.

## Validation and limits

Local fixtures cover PKCE construction, callback path rejection, replay prevention, cancellation, provider denial, listener cleanup, vault serialization and failures, and picker search. A Windows vault round trip and real terminal navigation were checked. Real-account OpenRouter/Puter authorization still needs authenticated end-to-end validation. Existing provider model/inference limitations remain in the [integration ledger](INTEGRATIONS.md).

Free allowances remain provider-specific and unknown unless explicitly observed. This release does not implement balance discovery, automatic live-provider fallback, official coding-agent bridges, or universal Google SSO.

## Extending account linking

Keep provider inference in `src/providers`, credential persistence in `src/auth/vault.ts`, and browser protocols in `src/auth/browser.ts`. Add official setup links in `src/auth/catalog.ts`. A new browser protocol must have provider documentation, bounded lifetime, cancellation, response validation, and tests before being offered as a supported sign-in method.

Protocol references: [OpenRouter OAuth](https://openrouter.ai/docs/guides/overview/auth/oauth), [Puter Node setup](https://docs.puter.com/getting-started/), [Kilo gateway authentication](https://kilo.ai/docs/gateway/authentication), [native credential vault](https://github.com/Brooooooklyn/keyring-node).
