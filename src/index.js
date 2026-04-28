import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ChannelType,
  MessageFlags,
  PermissionsBitField,
} from "discord.js";
import {
  addGame,
  getGameConfig,
  getGuildConfig,
  getAppCache,
  listGameConfigs,
  listGuildConfigs,
  removeGame,
  setFilterMode,
  setGameTarget,
  setIncludeLinks,
  setAppCache,
  setLastSeen,
  setTarget,
  getLastSeen,
} from "./db.js";
import {
  fetchAppName,
  fetchNewsForApp,
  filterNewsItems,
  stripSteamMarkup,
} from "./steam.js";
import { splitForDiscord } from "./split.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const STEAM_API_KEY = process.env.STEAM_API_KEY || "";
const POLL_INTERVAL_MS = Number.parseInt(process.env.POLL_INTERVAL_MS || "300000", 10);
const DEFAULT_FILTER_MODE = process.env.DEFAULT_FILTER_MODE || "patch_only";
const INCLUDE_SOURCE_LINKS = process.env.INCLUDE_SOURCE_LINKS !== "0";
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();

const LOG_LEVEL_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

function shouldLog(level) {
  const normalizedLevel = Object.hasOwn(LOG_LEVEL_PRIORITY, LOG_LEVEL) ? LOG_LEVEL : "info";
  const current = LOG_LEVEL_PRIORITY[normalizedLevel];
  const target = LOG_LEVEL_PRIORITY[level] ?? LOG_LEVEL_PRIORITY.info;
  return target >= current;
}

function formatLogContext(context = {}) {
  const entries = Object.entries(context).filter(([, value]) => value !== undefined && value !== null);
  if (!entries.length) return "";
  return ` ${entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ")}`;
}

function compactError(err) {
  if (!err) return {};
  if (typeof err === "string") return { message: err };

  const details = {};
  if (err.name) details.name = err.name;
  if (err.message) details.message = err.message;
  if (err.code !== undefined) details.code = err.code;
  if (err.status !== undefined) details.status = err.status;
  if (err.method) details.method = err.method;
  if (err.url) details.url = err.url;
  if (typeof err.stack === "string") {
    const stackLines = err.stack
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (stackLines.length > 1) {
      details.at = stackLines[1].replace(/^at\s+/, "");
    }
  }
  return details;
}

function log(level, message, context = {}, err = null) {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const base = `${ts} [${level.toUpperCase()}] ${message}${formatLogContext(context)}`;
  const line = err ? `${base}${formatLogContext({ error: compactError(err) })}` : base;
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function logDebug(message, context = {}) {
  log("debug", message, context);
}

function logInfo(message, context = {}) {
  log("info", message, context);
}

function logWarn(message, context = {}, err = null) {
  log("warn", message, context, err);
}

function logError(message, context = {}, err = null) {
  log("error", message, context, err);
}

const postLatestGuildInFlight = new Set();

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  logError("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function adminOnlyCommand(builder) {
  return builder.setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);
}

function configureTargetChannelOption(option, required) {
  return option
    .setName("channel")
    .setDescription("Target channel or thread")
    .setRequired(required)
    .addChannelTypes(
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread
    );
}

const commands = [
  adminOnlyCommand(new SlashCommandBuilder()
    .setName("set-target")
    .setDescription("Set the default or AppID-specific patch-note target")
    .addChannelOption((option) =>
      configureTargetChannelOption(option, true)
    )
    .addIntegerOption((option) =>
      option
        .setName("appid")
        .setDescription("Optional Steam AppID for a game-specific target")
        .setRequired(false)
    )),
  adminOnlyCommand(new SlashCommandBuilder()
    .setName("add-game")
    .setDescription("Add a Steam AppID to monitor")
    .addIntegerOption((option) =>
      option.setName("appid").setDescription("Steam AppID").setRequired(true)
    )
    .addChannelOption((option) =>
      configureTargetChannelOption(option, false)
    )),
  adminOnlyCommand(new SlashCommandBuilder()
    .setName("remove-game")
    .setDescription("Remove a Steam AppID from monitoring")
    .addIntegerOption((option) =>
      option.setName("appid").setDescription("Steam AppID").setRequired(true)
    )),
  new SlashCommandBuilder()
    .setName("list-games")
    .setDescription("List all monitored games"),
  adminOnlyCommand(new SlashCommandBuilder()
    .setName("set-filter")
    .setDescription("Set which news items to post")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Patch-only or all news")
        .setRequired(true)
        .addChoices(
          { name: "Patch notes only", value: "patch_only" },
          { name: "All news", value: "all" }
        )
    )),
  adminOnlyCommand(new SlashCommandBuilder()
    .setName("set-links")
    .setDescription("Enable or disable source links at the end of posts")
    .addStringOption((option) =>
      option
        .setName("enabled")
        .setDescription("Whether to include source links")
        .setRequired(true)
        .addChoices(
          { name: "On", value: "on" },
          { name: "Off", value: "off" }
        )
    )),
  adminOnlyCommand(new SlashCommandBuilder()
    .setName("post-latest")
    .setDescription("Fetch and post the latest patch notes for an AppID")
    .addIntegerOption((option) =>
      option.setName("appid").setDescription("Steam AppID").setRequired(true)
    )),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show current configuration for this server"),
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
}

function formatDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}.${month}.${year}`;
}

function buildMessages({ title, appLabel, date, content, url, includeLinks }) {
  const safeApp = appLabel.length > 180 ? `${appLabel.slice(0, 177)}...` : appLabel;
  const safeTitle = title.length > 180 ? `${title.slice(0, 177)}...` : title;
  const header = `**${safeApp}**\n${safeTitle} • ${formatDate(date)}\n\n`;
  const footer = includeLinks && url ? `\n\nSource: <${url}>` : "";

  const maxFirst = Math.max(200, 2000 - header.length - footer.length);
  const firstChunks = splitForDiscord(content, maxFirst);
  if (firstChunks.length === 1) {
    return [`${header}${firstChunks[0]}${footer}`.slice(0, 2000)];
  }

  const remaining = firstChunks.slice(1).join("\n\n");
  const restChunks = splitForDiscord(remaining, 2000);

  const messages = [];
  messages.push(`${header}${firstChunks[0]}`.slice(0, 2000));

  for (const chunk of restChunks) {
    messages.push(chunk.slice(0, 2000));
  }

  messages[messages.length - 1] = `${messages[messages.length - 1]}${footer}`.slice(0, 2000);
  return messages;
}

function getFilterMode(config) {
  return config?.filter_mode || DEFAULT_FILTER_MODE;
}

function getIncludeLinks(config) {
  return config?.include_links ?? INCLUDE_SOURCE_LINKS;
}

function getTargetChannelId(guildConfig, gameConfig) {
  return gameConfig?.target_channel_id ?? guildConfig?.target_channel_id ?? null;
}

function formatTarget(channelId) {
  return channelId ? `<#${channelId}>` : "(none)";
}

function fitDiscordMessage(content) {
  if (content.length <= 2000) return content;
  return `${content.slice(0, 1996)}...`;
}

async function resolveAppName(appId) {
  const cache = getAppCache(appId);
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 60 * 60 * 24 * 30; // 30 days
  if (cache && cache.updated_at && now - cache.updated_at < maxAge) {
    return cache.name;
  }

  try {
    const name = await fetchAppName(appId);
    if (name) {
      setAppCache(appId, name, now);
      return name;
    }
  } catch (err) {
    logWarn("App name lookup failed", { appId }, err);
  }

  return `AppID ${appId}`;
}

async function ensureTargetChannel(channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  if (channel.isThread()) {
    try {
      await channel.join();
    } catch {
      // Ignore if we cannot join threads (permissions)
    }
  }
  return channel;
}

async function pollOnce() {
  const guilds = listGuildConfigs();
  const stats = {
    guildsConfigured: guilds.length,
    guildsVisited: 0,
    appsVisited: 0,
    postedItems: 0,
    sendErrors: 0,
  };
  logInfo("Poll cycle started", { guilds: guilds.length });

  for (const guild of guilds) {
    const guildId = guild.guild_id;
    stats.guildsVisited += 1;
    try {
      if (!client.guilds.cache.has(guildId)) {
        logDebug("Skipping guild not found in client cache", { guildId });
        continue;
      }

      const games = listGameConfigs(guildId);
      if (!games.length) {
        logDebug("No monitored games configured for guild", { guildId });
        continue;
      }

      const targetChannels = new Map();
      async function resolvePollTarget(channelId) {
        if (!targetChannels.has(channelId)) {
          targetChannels.set(channelId, await ensureTargetChannel(channelId));
        }
        return targetChannels.get(channelId);
      }

      for (const game of games) {
        const appId = game.app_id;
        const targetChannelId = getTargetChannelId(guild, game);
        if (!targetChannelId) {
          logWarn("Skipping app with no target channel configured", { guildId, appId });
          continue;
        }

        const channel = await resolvePollTarget(targetChannelId);
        if (!channel) {
          logWarn("Skipping app with inaccessible target channel", {
            guildId,
            appId,
            targetChannelId,
          });
          continue;
        }

        stats.appsVisited += 1;
        let items;
        try {
          items = await fetchNewsForApp(appId, STEAM_API_KEY);
        } catch (err) {
          logWarn("Steam fetch failed", { guildId, appId }, err);
          continue;
        }

        const filtered = filterNewsItems(items, getFilterMode(guild));
        if (!filtered.length) continue;

        filtered.sort((a, b) => b.date - a.date);
        const lastSeen = getLastSeen(guildId, appId);

        if (!lastSeen) {
          setLastSeen(guildId, appId, filtered[0].date);
          logInfo("Initialized last_seen for app", {
            guildId,
            appId,
            lastSeenDate: filtered[0].date,
          });
          continue;
        }

        const newItems = filtered
          .filter((item) => item.date > lastSeen)
          .sort((a, b) => a.date - b.date);

        if (!newItems.length) continue;

        const appLabel = await resolveAppName(appId);

        for (const item of newItems) {
          const content = stripSteamMarkup(item.contents || "");
          const messages = buildMessages({
            title: item.title || `Steam Update ${item.gid}`,
            appLabel,
            date: item.date,
            content: content || "(No details provided)",
            url: item.url,
            includeLinks: getIncludeLinks(guild),
          });

          try {
            for (const message of messages) {
              await channel.send({
                content: message,
                allowedMentions: { parse: [] },
                suppressEmbeds: true,
                flags: MessageFlags.SuppressEmbeds,
              });
            }
          } catch (err) {
            stats.sendErrors += 1;
            logError(
              "Failed to post news item",
              {
                guildId,
                appId,
                channelId: channel.id,
                itemGid: item.gid,
                itemDate: item.date,
              },
              err
            );
            // Keep the failed item as unseen so it can be retried on the next cycle.
            break;
          }

          setLastSeen(guildId, appId, item.date);
          stats.postedItems += 1;
          logInfo("Posted news item", {
            guildId,
            appId,
            channelId: channel.id,
            itemGid: item.gid,
            itemDate: item.date,
            chunks: messages.length,
          });
        }
      }
    } catch (err) {
      stats.sendErrors += 1;
      logError("Unhandled guild polling failure", { guildId }, err);
    }
  }

  logInfo("Poll cycle finished", stats);
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) {
    await interaction.reply({ content: "This bot works inside servers only.", ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  const adminOnlyCommands = new Set([
    "set-target",
    "add-game",
    "remove-game",
    "set-filter",
    "set-links",
    "post-latest",
  ]);
  if (adminOnlyCommands.has(interaction.commandName)) {
    const isAdmin = interaction.memberPermissions?.has(
      PermissionsBitField.Flags.Administrator
    );
    if (!isAdmin) {
      logWarn("Rejected command from non-admin member", {
        command: interaction.commandName,
        guildId,
        userId: interaction.user?.id,
      });
      await interaction.reply({
        content: "Only server administrators can configure this bot.",
        ephemeral: true,
      });
      return;
    }
  }

  try {
    switch (interaction.commandName) {
      case "set-target": {
        const channel = interaction.options.getChannel("channel", true);
        const appId = interaction.options.getInteger("appid", false);
        if (!channel.isTextBased()) {
          await interaction.reply({
            content: "Please choose a text channel or thread.",
            ephemeral: true,
          });
          return;
        }

        if (appId !== null) {
          if (!Number.isInteger(appId) || appId <= 0) {
            await interaction.reply({
              content: "Please provide a valid Steam AppID.",
              ephemeral: true,
            });
            return;
          }
          setGameTarget(guildId, appId, channel.id);
          await interaction.reply({
            content: `Target for AppID ${appId} set to <#${channel.id}>.`,
            ephemeral: true,
          });
          return;
        }

        setTarget(guildId, channel.id, {
          filterMode: DEFAULT_FILTER_MODE,
          includeLinks: INCLUDE_SOURCE_LINKS ? 1 : 0,
        });
        await interaction.reply({
          content: `Target set to <#${channel.id}>.`,
          ephemeral: true,
        });
        return;
      }
      case "add-game": {
        const appId = interaction.options.getInteger("appid", true);
        const channel = interaction.options.getChannel("channel", false);
        if (!Number.isInteger(appId) || appId <= 0) {
          await interaction.reply({
            content: "Please provide a valid Steam AppID.",
            ephemeral: true,
          });
          return;
        }

        if (channel && !channel.isTextBased()) {
          await interaction.reply({
            content: "Please choose a text channel or thread.",
            ephemeral: true,
          });
          return;
        }

        addGame(guildId, appId, channel?.id ?? null);
        await interaction.reply({
          content: channel
            ? `Added AppID ${appId} with target <#${channel.id}>. New posts will start from the next update.`
            : `Added AppID ${appId}. New posts will start from the next update.`,
          ephemeral: true,
        });
        return;
      }
      case "remove-game": {
        const appId = interaction.options.getInteger("appid", true);
        removeGame(guildId, appId);
        await interaction.reply({
          content: `Removed AppID ${appId}.`,
          ephemeral: true,
        });
        return;
      }
      case "list-games": {
        await interaction.deferReply({ ephemeral: true });
        const config = getGuildConfig(guildId);
        const games = listGameConfigs(guildId);
        if (!games.length) {
          await interaction.editReply("No games configured yet.");
          return;
        }

        const gameLabels = await Promise.all(
          games.map(async (game) => {
            const appId = game.app_id;
            const appName = await resolveAppName(appId);
            const label = appName === `AppID ${appId}`
              ? appName
              : `${appName} (AppID: ${appId})`;
            const targetChannelId = getTargetChannelId(config, game);
            const target = targetChannelId ? formatTarget(targetChannelId) : "no target";
            const source = game.target_channel_id ? "custom" : "default";
            return `${label} -> ${target}${targetChannelId ? ` (${source})` : ""}`;
          })
        );
        await interaction.editReply(fitDiscordMessage(`Monitored games:\n- ${gameLabels.join("\n- ")}`));
        return;
      }
      case "set-filter": {
        const mode = interaction.options.getString("mode", true);
        setFilterMode(guildId, mode);
        await interaction.reply({
          content: `Filter mode set to ${mode}.`,
          ephemeral: true,
        });
        return;
      }
      case "set-links": {
        const enabled = interaction.options.getString("enabled", true);
        const include = enabled === "on";
        setIncludeLinks(guildId, include ? 1 : 0);
        await interaction.reply({
          content: `Source links ${include ? "enabled" : "disabled"}.`,
          ephemeral: true,
        });
        return;
      }
      case "post-latest": {
        const appId = interaction.options.getInteger("appid", true);
        if (!Number.isInteger(appId) || appId <= 0) {
          await interaction.reply({
            content: "Please provide a valid Steam AppID.",
            ephemeral: true,
          });
          return;
        }
        const config = getGuildConfig(guildId);
        const gameConfig = getGameConfig(guildId, appId);
        const targetChannelId = getTargetChannelId(config, gameConfig);

        if (postLatestGuildInFlight.has(guildId)) {
          await interaction.reply({
            content: "A /post-latest request is already running for this server. Please wait.",
            ephemeral: true,
          });
          return;
        }

        postLatestGuildInFlight.add(guildId);

        try {
          await interaction.deferReply({ ephemeral: true });

          if (!targetChannelId) {
            await interaction.editReply(
              `No target is configured for AppID ${appId}. Use /set-target with appid:${appId} or configure a default target.`
            );
            return;
          }

          const targetChannel = await ensureTargetChannel(targetChannelId);
          if (!targetChannel) {
            await interaction.editReply(
              "I cannot access the configured target channel or thread."
            );
            return;
          }

          let items;
          try {
            items = await fetchNewsForApp(appId, STEAM_API_KEY);
          } catch (err) {
            await interaction.editReply(
              `Steam API request failed for AppID ${appId}.`
            );
            return;
          }

          const filtered = filterNewsItems(
            items,
            getFilterMode(config)
          );
          if (!filtered.length) {
            await interaction.editReply("No patch notes found for that AppID.");
            return;
          }

          filtered.sort((a, b) => b.date - a.date);
          const item = filtered[0];
          const appLabel = await resolveAppName(appId);
          const content = stripSteamMarkup(item.contents || "");
          const messages = buildMessages({
            title: item.title || `Steam Update ${item.gid}`,
            appLabel,
            date: item.date,
            content: content || "(No details provided)",
            url: item.url,
            includeLinks: getIncludeLinks(config),
          });

          try {
            for (const message of messages) {
              await targetChannel.send({
                content: message,
                allowedMentions: { parse: [] },
                suppressEmbeds: true,
                flags: MessageFlags.SuppressEmbeds,
              });
            }
          } catch (err) {
            logError(
              "Failed to post latest news item",
              {
                guildId,
                appId,
                channelId: targetChannel.id,
                itemGid: item.gid,
                itemDate: item.date,
              },
              err
            );
            await interaction.editReply(
              "I cannot post in the configured target channel or thread. Check channel permissions."
            );
            return;
          }

          setLastSeen(guildId, appId, item.date);
          await interaction.editReply(`Posted latest patch notes for AppID ${appId}.`);
        } finally {
          postLatestGuildInFlight.delete(guildId);
        }
        return;
      }
      case "status": {
        const config = getGuildConfig(guildId);
        const games = listGameConfigs(guildId);
        if (!config && !games.length) {
          await interaction.reply({
            content: "No configuration yet. Use /set-target or /add-game first.",
            ephemeral: true,
          });
          return;
        }
        const target = formatTarget(config?.target_channel_id);
        const filter = getFilterMode(config);
        const links = getIncludeLinks(config) ? "on" : "off";
        const gamesText = games.length
          ? games
              .map((game) => {
                const targetChannelId = getTargetChannelId(config, game);
                const targetText = targetChannelId ? formatTarget(targetChannelId) : "no target";
                const source = game.target_channel_id ? "custom" : "default";
                return `${game.app_id}: ${targetText}${targetChannelId ? ` (${source})` : ""}`;
              })
              .join("\n")
          : "(none)";
        await interaction.reply({
          content: fitDiscordMessage(`Default target: ${target}\nFilter: ${filter}\nLinks: ${links}\nGames:\n${gamesText}`),
          ephemeral: true,
        });
        return;
      }
      default:
        await interaction.reply({ content: "Unknown command.", ephemeral: true });
    }
  } catch (err) {
    logError(
      "Command failed",
      {
        command: interaction.commandName,
        guildId,
        userId: interaction.user?.id,
      },
      err
    );
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
    } else {
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  }
});

client.once("ready", async () => {
  logInfo("Bot logged in", { tag: client.user.tag });
  try {
    await registerCommands();
    logInfo("Slash commands registered");
  } catch (err) {
    logError("Failed to register commands", {}, err);
  }

  await pollOnce().catch((err) => logError("Initial poll failed", {}, err));
  logInfo("Polling scheduler started", { intervalMs: POLL_INTERVAL_MS });
  setInterval(() => {
    pollOnce().catch((err) => logError("Poll cycle crashed", {}, err));
  }, POLL_INTERVAL_MS);
});

client.login(DISCORD_TOKEN);
