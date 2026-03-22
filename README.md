# Patchbot-Style Discord Bot (Steam)

This bot monitors Steam news for specific AppIDs and posts full patch-note text into a chosen Discord channel or thread. It avoids link-embeds and splits large posts across multiple messages.

## Features
- Per-server configuration for target channel/thread
- Per-server list of Steam AppIDs to monitor
- Patch-only or all-news modes
- Full text posting with smart splitting for Discord’s 2000 character limit
- Optional source link at the end (embeds suppressed)

## Setup
1. Create a Discord application + bot in the Discord Developer Portal.
2. Copy the bot token and the application client ID.
3. Invite the bot with scopes `bot` and `applications.commands`.
4. Configure the required bot permissions (see section below).
5. Optional but recommended: create a Steam Web API key (see section below).

## Discord Bot Permissions
This bot does not need `Administrator`. Use least privilege.

Required bot permissions:
- `View Channels`
- `Send Messages`
- `Send Messages in Threads` (required when target is a thread)
- `Read Message History`

Recommended for thread targets:
- `Manage Threads` (helps with joining/using existing threads reliably)

Not required for this bot:
- `Administrator`
- `Manage Channels`
- `Manage Roles`
- `Embed Links` (messages are plain text and embeds are suppressed)

Important: channel-level overrides can still block the bot even if role-level permissions look correct. If posting fails with `Missing Permissions (50013)`, check the target channel's permission overrides.

## Steam Web API Key
`STEAM_API_KEY` is optional in this bot, but recommended for reliability.

What it is used for:
- Included in Steam news API requests (`GetNewsForApp`) when provided.
- Helps avoid anonymous request limitations on some setups.

How to create one:
1. Sign in to Steam with an account that can create API keys.
2. Open: `https://steamcommunity.com/dev/apikey`
3. Register an API key and copy it.
4. Put it into `.env` as `STEAM_API_KEY=...`

Security notes:
- Treat the key like a password.
- Never commit it to git or share it in screenshots/logs.
- If leaked, revoke/regenerate it from the Steam API key page.

If you leave `STEAM_API_KEY` empty:
- The bot still runs and may work fine.
- If Steam rate-limits or restricts anonymous access, news fetches can fail intermittently.

## Configure
Create a `.env` file (see `.env.example`):

```bash
DISCORD_TOKEN=YOUR_TOKEN
DISCORD_CLIENT_ID=YOUR_CLIENT_ID
STEAM_API_KEY=YOUR_STEAM_KEY   # optional
POLL_INTERVAL_MS=300000
DEFAULT_FILTER_MODE=patch_only
INCLUDE_SOURCE_LINKS=1
LOG_LEVEL=info
```

## Install + Run
```bash
npm install
npm run start
```

## Logging
The bot writes logs to process output:
- `stdout`: informational logs (`debug` / `info`)
- `stderr`: warnings and errors (`warn` / `error`)

There is no dedicated log file by default. Where logs appear depends on how you run the bot:
- Foreground terminal: logs appear directly in the terminal window.
- `systemd`: logs are available via `journalctl`.
- Docker: logs are available via `docker logs`.
- PM2: logs are available via `pm2 logs`.

Log line format:
- ISO timestamp
- Log level (`DEBUG`, `INFO`, `WARN`, `ERROR`)
- Message
- Structured context fields (for example `guildId`, `appId`, `channelId`)
- Compact error details on failures (for example HTTP status/code)

Set verbosity with `LOG_LEVEL` in `.env`:
- `debug`: most verbose (all internal flow details)
- `info`: normal operation logs (recommended default)
- `warn`: warnings and errors only
- `error`: errors only

Common commands to inspect logs:
- Terminal run: start with `npm run start`
- systemd: `journalctl -u <service-name> -f`
- Docker: `docker logs -f <container>`
- PM2: `pm2 logs <app-name> --lines 200`

If you want file logs, redirect output manually (example):
```bash
node src/index.js >> logs/patchbot.out.log 2>> logs/patchbot.err.log
```

## Commands
- `/set-target channel:#channel-or-thread`
- `/add-game appid:123456`
- `/remove-game appid:123456`
- `/list-games`
- `/set-filter mode:patch_only|all`
- `/set-links enabled:on|off`
- `/post-latest appid:123456`
- `/status`

## Access Control and Abuse Protection
- Configuration commands are admin-only: `/set-target`, `/add-game`, `/remove-game`, `/set-filter`, `/set-links`, and `/post-latest`.
- Admin-only access is enforced in two layers:
  - Discord command defaults (`Administrator` required to run those commands)
  - Runtime permission check in bot code (`interaction.memberPermissions`)
- `/post-latest` has no cooldown. It is restricted by admin-only permissions.

## Notes
- On first detection of a game, the bot **does not backfill** old patch notes. It starts from the next new update to avoid flooding. If you want backfill, remove the `last_seen` row in the SQLite database or add a custom command.
- Steam news content can include BBCode/HTML. The bot strips most formatting for clean text.
- In `patch_only` mode, the bot only uses official Steam community announcement feed posts (external media reposts are ignored).

## Data Storage
- SQLite database: `data/bot.sqlite`

## Troubleshooting
- If the bot doesn’t post, check that it can see the target channel/thread and has permissions.
- Slash commands can take a few minutes to appear after startup.
- For logging details and where to view logs, see the `Logging` section above.
