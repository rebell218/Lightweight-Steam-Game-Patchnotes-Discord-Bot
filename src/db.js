import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.resolve("data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "bot.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    target_channel_id TEXT NOT NULL,
    filter_mode TEXT NOT NULL DEFAULT 'patch_only',
    include_links INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS game_config (
    guild_id TEXT NOT NULL,
    app_id INTEGER NOT NULL,
    PRIMARY KEY (guild_id, app_id)
  );

  CREATE TABLE IF NOT EXISTS last_seen (
    guild_id TEXT NOT NULL,
    app_id INTEGER NOT NULL,
    last_date INTEGER NOT NULL,
    PRIMARY KEY (guild_id, app_id)
  );

  CREATE TABLE IF NOT EXISTS app_cache (
    app_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const stmtSetTarget = db.prepare(
  `INSERT INTO guild_config (guild_id, target_channel_id, filter_mode, include_links)
   VALUES (@guild_id, @target_channel_id, COALESCE(@filter_mode, 'patch_only'), COALESCE(@include_links, 1))
   ON CONFLICT(guild_id) DO UPDATE SET target_channel_id = excluded.target_channel_id`
);

const stmtGetGuild = db.prepare(
  `SELECT guild_id, target_channel_id, filter_mode, include_links FROM guild_config WHERE guild_id = ?`
);

const stmtListGuilds = db.prepare(
  `SELECT guild_id, target_channel_id, filter_mode, include_links FROM guild_config`
);

const stmtSetFilter = db.prepare(
  `UPDATE guild_config SET filter_mode = ? WHERE guild_id = ?`
);

const stmtSetIncludeLinks = db.prepare(
  `UPDATE guild_config SET include_links = ? WHERE guild_id = ?`
);

const stmtAddGame = db.prepare(
  `INSERT OR IGNORE INTO game_config (guild_id, app_id) VALUES (?, ?)`
);

const stmtRemoveGame = db.prepare(
  `DELETE FROM game_config WHERE guild_id = ? AND app_id = ?`
);

const stmtListGames = db.prepare(
  `SELECT app_id FROM game_config WHERE guild_id = ? ORDER BY app_id ASC`
);

const stmtGetLastSeen = db.prepare(
  `SELECT last_date FROM last_seen WHERE guild_id = ? AND app_id = ?`
);

const stmtSetLastSeen = db.prepare(
  `INSERT INTO last_seen (guild_id, app_id, last_date)
   VALUES (?, ?, ?)
   ON CONFLICT(guild_id, app_id) DO UPDATE SET last_date = excluded.last_date`
);

const stmtGetAppCache = db.prepare(
  `SELECT name, updated_at FROM app_cache WHERE app_id = ?`
);

const stmtSetAppCache = db.prepare(
  `INSERT INTO app_cache (app_id, name, updated_at)
   VALUES (?, ?, ?)
   ON CONFLICT(app_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
);

export function setTarget(guildId, channelId, { filterMode, includeLinks } = {}) {
  stmtSetTarget.run({
    guild_id: guildId,
    target_channel_id: channelId,
    filter_mode: filterMode ?? null,
    include_links: includeLinks ?? null,
  });
}

export function getGuildConfig(guildId) {
  return stmtGetGuild.get(guildId) ?? null;
}

export function listGuildConfigs() {
  return stmtListGuilds.all();
}

export function setFilterMode(guildId, filterMode) {
  stmtSetFilter.run(filterMode, guildId);
}

export function setIncludeLinks(guildId, includeLinks) {
  stmtSetIncludeLinks.run(includeLinks ? 1 : 0, guildId);
}

export function addGame(guildId, appId) {
  stmtAddGame.run(guildId, appId);
}

export function removeGame(guildId, appId) {
  stmtRemoveGame.run(guildId, appId);
}

export function listGames(guildId) {
  return stmtListGames.all(guildId).map((row) => row.app_id);
}

export function getLastSeen(guildId, appId) {
  const row = stmtGetLastSeen.get(guildId, appId);
  return row ? row.last_date : null;
}

export function setLastSeen(guildId, appId, lastDate) {
  stmtSetLastSeen.run(guildId, appId, lastDate);
}

export function getAppCache(appId) {
  return stmtGetAppCache.get(appId) ?? null;
}

export function setAppCache(appId, name, updatedAt) {
  stmtSetAppCache.run(appId, name, updatedAt);
}

export default db;
