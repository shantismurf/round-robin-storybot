# Round-Robin Storybot

A Discord bot for running collaborative round-robin story writing events.

Quick start

1. Copy `config.example.json` to `config.json` and fill tokens/IDs.
2. npm install
3. npm start

Project layout
- `index.js` — minimal bootstrap and Discord client wiring.
- `storybot.js` — core round-robin logic and turn lifecycle.
- `embeds/buildEmbed.js` — embed helpers.
- `utilities.js` — shared helpers (config, DB helper, small utils).
- `commands/` — slash command handlers.
- `db/migrations/` — SQL migration files.

See `docs/` (planned) for developer and operator guidance.
