import he from "he";

const PATCH_REGEX = /(patch|hotfix|update|changelog|version)/i;
const OFFICIAL_FEED = "steam_community_announcements";

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
  url.searchParams.set("count", "10");
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
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
    const trimmed = match.replace(/[)\].,!?]+$/g, "");
    const trailing = match.slice(trimmed.length);
    if (!trimmed) return match;
    return `<${trimmed}>${trailing}`;
  });

  // Normalize whitespace
  text = text.replace(/[\t\f\v]+/g, " ");
  text = text.replace(/ *\n */g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/\n\n- /g, "\n- ");
  text = text.replace(/^\s*\\\s*$/gm, "");
  text = text.replace(/^\s*\[\/\*?\]\s*$/gm, "");

  return text.trim();
}
