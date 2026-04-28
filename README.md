# Lightweight Steam Patchnotes Discord Bot

This bot monitors Steam news for specific AppIDs and posts full patch-note text into a chosen Discord channel or thread. It avoids link-embeds and splits large posts across multiple messages.

## Features
- Per-server default target channel/thread
- Optional per-AppID target channel/thread overrides
- Per-server list of Steam AppIDs to monitor
- `/list-games` resolves and shows `Game Title (AppID: 123456)`
- Patch-only or all-news modes
- Full text posting with smart splitting for Discord’s 2000 character limit
- Optional source link at the end (embeds suppressed)

## Commands
- `/set-target channel:#channel-or-thread`
- `/set-target channel:#channel-or-thread appid:123456`
- `/add-game appid:123456`
- `/add-game appid:123456 channel:#channel-or-thread`
- `/remove-game appid:123456`
- `/list-games`
- `/set-filter mode:patch_only|all`
- `/set-links enabled:on|off`
- `/post-latest appid:123456`
- `/status`

## Setup
1. Create a Discord application + bot in the Discord Developer Portal.
2. Copy the bot token and the application client ID.
3. Invite the bot with scopes `bot` and `applications.commands`.
4. Configure the required bot permissions (see section below).
5. Optional but recommended: create a Steam Web API key (see section below).
6. Create a `.env` file (see `.env.example`):

## Install + Run
```bash
npm install
npm run start
```



## Discord Bot Permissions
Required bot permissions:
- `View Channels`
- `Send Messages`
- `Send Messages in Threads` (required when target is a thread)
- `Read Message History`

Recommended for thread targets:
- `Manage Threads` (helps with joining/using existing threads reliably)


## Steam Web API Key
`STEAM_API_KEY` is optional in this bot, but recommended for reliability.

What it is used for:
- Included in Steam news API requests (`GetNewsForApp`) when provided.
- Helps avoid anonymous request limitations on some setups.


## Logging
The bot writes logs to process output:
- `stdout`: informational logs (`debug` / `info`)
- `stderr`: warnings and errors (`warn` / `error`)

Set verbosity with `LOG_LEVEL` in `.env`:
- `debug`: most verbose (all internal flow details)
- `info`: normal operation logs (recommended default)
- `warn`: warnings and errors only
- `error`: errors only


## Access Control and Abuse Protection
- Configuration commands are admin-only: `/set-target`, `/add-game`, `/remove-game`, `/set-filter`, `/set-links`, and `/post-latest`.
- Admin-only access is enforced in two layers:
  - Discord command defaults (`Administrator` required to run those commands)
  - Runtime permission check in bot code (`interaction.memberPermissions`)


## Notes
- On first detection of a game, the bot **does not backfill** old patch notes. It starts from the next new update to avoid flooding. If you want backfill, remove the `last_seen` row in the SQLite database or add a custom command.
- AppID-specific targets override the default server target. Games without their own target use the default target. Games with neither an AppID-specific target nor a default target are skipped until a target is configured.
- Steam news content can include BBCode/HTML. The bot strips most formatting for clean text.
- In `patch_only` mode, the bot only uses official Steam community announcement feed posts (external media reposts are ignored).

## Data Storage
- SQLite database: `data/bot.sqlite`

## Troubleshooting
- If the bot doesn’t post, check that it can see the target channel/thread and has permissions.
- Slash commands can take a few minutes to appear after startup.
- For logging details and where to view logs, see the `Logging` section above.
