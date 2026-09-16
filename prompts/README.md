# Robinhood system prompt

`system.md` is the active agent prompt, adapted from the user-supplied collection in `source/Robinhood_syste_prompts.md`. The source is preserved byte-for-byte (SHA-256: `319cf43ef0e29d0585ee97e5b0d826fc518e700934963a47e398e4b035b57076`).

The 339 KB collection contains alternative model templates, policy overrides, classifiers and tool descriptions. These cannot all be active at once and exceed the preview's model context budget. The active prompt uses its base agent template: persistence, thoughtful implementation, plain communication, focused verification and task completion. It adapts identity, communication and tool references to capabilities Robinhood actually exposes. Runtime approvals, plan mode and receipt recovery remain enforced in code.

Changing prose does not grant tools, improve underlying model weights, or remove provider limits. Inspect `/prompt` in the terminal to see the active prompt. The bundled file is loaded at startup from this checkout, so edits apply after restart.

`compact.md` is a condensed, explicitly text-only adaptation for AI Horde, whose 8 KiB request budget cannot carry the full base template. `/prompt` displays the profile selected for the current provider. Other providers use `system.md`.
