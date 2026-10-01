import he from "he";
import { XMLParser } from "fast-xml-parser";

const PATCH_REGEX = /(patch|hotfix|update|changelog|version)/i;
const OFFICIAL_FEED = "steam_community_announcements";
const NEWS_FETCH_COUNT = 10;
const RSS_LANGUAGE = "english";

const rssParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: false,
  textNodeName: "text",
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && "text" in value) {
    return nodeText(value.text);
  }
  return he.decode(String(value)).trim();
}

function gidFromSteamNewsUrl(url) {
  const match = String(url).match(/\/view\/(\d+)/);
  return match?.[1] ?? String(url);
}

function normalizeRawUrls(text) {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
    const trimmed = match.replace(/[)\].,!?]+$/g, "");
    const trailing = match.slice(trimmed.length);
    if (!trimmed) return match;
    return `<${trimmed}>${trailing}`;
  });
}

function normalizeText(text) {
  return text
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n- /g, "\n- ")
    .replace(/^\s*\\\s*$/gm, "")
    .replace(/^\s*\[\/\*?\]\s*$/gm, "")
    .trim();
}

function isOfficialSteamAnnouncement(item) {
  const feedName = String(item.feedname ?? "").toLowerCase();
  if (feedName === OFFICIAL_FEED) {
    return true;
  }

  // Some items include only URL metadata; keep a URL fallback check.
  const url = String(item.url ?? "").toLowerCase();
  return url.includes(`/news/externalpost/${OFFICIAL_FEED}/`);
}

export async function fetchNewsForApp(appId, apiKey) {
  const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
  url.searchParams.set("appid", String(appId));
  url.searchParams.set("count", String(NEWS_FETCH_COUNT));
  url.searchParams.set("maxlength", "0");
  if (apiKey) {
    url.searchParams.set("key", apiKey);
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Steam API error ${res.status} for app ${appId}`);
  }
  const payload = await res.json();
  const items = payload?.appnews?.newsitems ?? [];
  return items;
}

export async function fetchRssNewsForApp(appId) {
  const url = new URL(`https://store.steampowered.com/feeds/news/app/${appId}/`);
  url.searchParams.set("l", RSS_LANGUAGE);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Steam RSS error ${res.status} for app ${appId}`);
  }

  const xml = await res.text();
  const payload = rssParser.parse(xml);
  const items = asArray(payload?.rss?.channel?.item);

  return items
    .map((item) => {
      const title = nodeText(item.title);
      const description = nodeText(item.description);
      const link = nodeText(item.link);
      const guid = nodeText(item.guid) || link;
      const pubDate = nodeText(item.pubDate);
      const dateMs = Date.parse(pubDate);

      return {
        gid: gidFromSteamNewsUrl(guid || link),
        title,
        date: Number.isNaN(dateMs) ? 0 : Math.floor(dateMs / 1000),
        contents: description,
        url: link || guid,
        feedname: OFFICIAL_FEED,
        newsitemtype: "",
        source: "rss",
        content_format: "rss_html",
      };
    })
    .filter((item) => item.date > 0);
}

export async function fetchAppName(appId) {
  const url = new URL("https://store.steampowered.com/api/appdetails");
  url.searchParams.set("appids", String(appId));
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Steam Store API error ${res.status} for app ${appId}`);
  }
  const payload = await res.json();
  const entry = payload?.[appId]?.data;
  return entry?.name || null;
}

export function filterNewsItems(items, mode) {
  if (mode === "all") {
    return items;
  }
  return items.filter((item) => {
    if (!isOfficialSteamAnnouncement(item)) {
      return false;
    }
    const type = String(item.newsitemtype ?? "");
    const title = String(item.title ?? "");
    return PATCH_REGEX.test(type) || PATCH_REGEX.test(title);
  });
}

export function stripRssHtml(input) {
  if (!input) return "";
  let text = he.decode(String(input));

  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\\\[/g, "[");
  text = text.replace(/\\\]/g, "]");

  text = text.replace(/<\s*(?:video|script|style)\b[\s\S]*?<\s*\/\s*(?:video|script|style)\s*>/gi, "");
  text = text.replace(/<\s*(?:img|source)\b[^>]*>/gi, "");

  text = text.replace(
    /<a\b[^>]*href=(["']?)([^"'\s>]+)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (match, quote, url, label) => {
      const cleanUrl = he.decode(String(url)).trim();
      const cleanLabel = he.decode(String(label ?? "").replace(/<[^>]*>/g, "")).trim();
      if (!cleanLabel) return cleanUrl;
      if (cleanLabel === cleanUrl) return cleanUrl;
      return `${cleanLabel} (${cleanUrl})`;
    }
  );

  text = text.replace(/<\s*br\s*\/?>/gi, "\n");
  text = text.replace(/<\s*\/p\s*>/gi, "\n\n");
  text = text.replace(/<\s*p\b[^>]*>/gi, "");
  text = text.replace(/<\s*li\b[^>]*>/gi, "\n- ");
  text = text.replace(/<\s*\/li\s*>/gi, "\n");
  text = text.replace(/<\s*\/?(?:ul|ol)\b[^>]*>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");

  text = he.decode(text);

  text = text.replace(
    /^\s*\[\s*([A-Z0-9][A-Z0-9 _-]{1,60})\s*\]\s*$/gm,
    (match, title) => `\n**${String(title).trim()}**\n`
  );

  text = normalizeRawUrls(text);
  return normalizeText(text);
}

export function stripSteamMarkup(input) {
  if (!input) return "";
  let text = String(input);

  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\\\[/g, "[");
  text = text.replace(/\\\]/g, "]");

  // URLs
  text = text.replace(/\[url=(.+?)\]([\s\S]*?)\[\/url\]/gi, (match, url, label) => {
    const cleanUrl = String(url).trim().replace(/^["']|["']$/g, "");
    const cleanLabel = String(label ?? "").trim();
    if (!cleanLabel) return cleanUrl;
    if (cleanLabel === cleanUrl) return cleanUrl;
    return `${cleanLabel} (${cleanUrl})`;
  });
  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (match, url) => {
    const cleanUrl = String(url).trim();
    return cleanUrl || "";
  });

  // Images and media
  text = text.replace(/\[img[^\]]*\](?:[\s\S]*?)\[\/img\]/gi, "");
  text = text.replace(/\[img[^\]]*\]/gi, "");
  text = text.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, "");
  text = text.replace(/\[previewyoutube\][\s\S]*?\[\/previewyoutube\]/gi, "");
  text = text.replace(/\[youtube\][\s\S]*?\[\/youtube\]/gi, "");

  // Headings -> bold (trim content)
  text = text.replace(/\[h[1-6]\]([\s\S]*?)\[\/h[1-6]\]/gi, (match, title) => {
    return `\n**${String(title).trim()}**\n`;
  });

  // Paragraphs
  text = text.replace(/\[p\]/gi, "");
  text = text.replace(/\[\/p\]/gi, "\n\n");

  // Lists
  text = text.replace(/\[(?:list|olist)\]/gi, "\n");
  text = text.replace(/\[\/(?:list|olist)\]/gi, "\n");
  text = text.replace(/\[\*\]/g, "\n- ");
  text = text.replace(/\[\/\*\]/g, "\n");

  // Bracketed section headings like [ MAP SCRIPTING ]
  text = text.replace(
    /^\s*\[\s*([A-Z0-9][A-Z0-9 _-]{1,60})\s*\]\s*$/gm,
    (match, title) => `\n**${String(title).trim()}**\n`
  );

  // Inline formatting
  text = text.replace(/\[b\]/gi, "**");
  text = text.replace(/\[\/b\]/gi, "**");
  text = text.replace(/\[i\]/gi, "*");
  text = text.replace(/\[\/i\]/gi, "*");
  text = text.replace(/\[u\]/gi, "__");
  text = text.replace(/\[\/u\]/gi, "__");
  text = text.replace(/\[(?:strike|s)\]/gi, "~~");
  text = text.replace(/\[\/(?:strike|s)\]/gi, "~~");

  // Other tags we just drop
  text = text.replace(
    /\[(?:\/)?(?:quote|code|spoiler|hr|table|tr|td|th|tbody|thead|center|noparse)\b[^\]]*\]/gi,
    ""
  );
  text = text.replace(/\[(?:\/)?color(?:=[^\]]+)?\]/gi, "");
  text = text.replace(/\[(?:\/)?size(?:=[^\]]+)?\]/gi, "");

  // Remove any remaining BBCode tags (but keep bracketed headings with spaces)
  text = text.replace(/\[(?:\/)?[a-z][a-z0-9]*(?:=[^\]]+)?\]/gi, "");

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  text = he.decode(text);

  // De-embed raw URLs by wrapping them in angle brackets
  text = normalizeRawUrls(text);

  // Normalize whitespace
  return normalizeText(text);
}
