import he from "he";
import { XMLParser } from "fast-xml-parser";
import TurndownService from "turndown";

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

const markdownConverter = new TurndownService({
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  headingStyle: "atx",
  strongDelimiter: "**",
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

function normalizeConvertedMarkdown(text) {
  return normalizeText(text)
    .replace(/^(\s*[-*+])\s{2,}/gm, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function directChildCells(row) {
  return Array.from(row.children ?? []).filter((child) => {
    const tagName = String(child.tagName ?? child.nodeName ?? "").toLowerCase();
    return tagName === "th" || tagName === "td";
  });
}

function tableRows(table) {
  return Array.from(table.querySelectorAll?.("tr") ?? [])
    .map((row) => {
      const cells = directChildCells(row);
      return {
        cells,
        hasHeader: cells.some((cell) => {
          const tagName = String(cell.tagName ?? cell.nodeName ?? "").toLowerCase();
          return tagName === "th";
        }),
      };
    })
    .filter((row) => row.cells.length);
}

markdownConverter.addRule("steamHeading", {
  filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
  replacement(content) {
    return `\n\n**${content.trim()}**\n\n`;
  },
});

markdownConverter.addRule("steamTable", {
  filter: "table",
  replacement(_content, node) {
    const rows = tableRows(node);
    if (!rows.length) return "";

    const firstRow = rows[0];
    const hasHeader = firstRow.hasHeader;
    const headers = hasHeader
      ? firstRow.cells.map((cell) => markdownConverter.turndown(cell.innerHTML).trim())
      : [];
    const dataRows = hasHeader ? rows.slice(1) : rows;

    if (headers.length === 1) {
      const entries = dataRows
        .map((row) => markdownConverter.turndown(row.cells[0].innerHTML).trim())
        .filter(Boolean)
        .map((entry) => `- ${entry}`);
      return `\n\n**${headers[0]}**\n\n${entries.join("\n")}\n\n`;
    }

    const renderedRows = dataRows
      .map((row) => {
        const values = row.cells.map((cell) =>
          markdownConverter.turndown(cell.innerHTML).trim()
        );
        const pairs = values
          .map((value, index) => {
            if (!value) return "";
            const label = headers[index];
            return label ? `**${label}:** ${value}` : value;
          })
          .filter(Boolean);
        return pairs.length ? `- ${pairs.join(" — ")}` : "";
      })
      .filter(Boolean);

    return `\n\n${renderedRows.join("\n")}\n\n`;
  },
});

markdownConverter.addRule("steamMedia", {
  filter: ["img", "source", "video", "audio", "iframe", "object", "embed"],
  replacement() {
    return "";
  },
});

function convertHtmlToDiscordMarkdown(input) {
  if (!input) return "";
  const html = he.decode(String(input))
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]");
  return normalizeConvertedMarkdown(markdownConverter.turndown(html));
}

function convertSteamBbcodeToHtml(input) {
  let text = String(input ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]");

  text = text.replace(
    /\[(?:carousel|previewyoutube|youtube|video|img)[^\]]*\][\s\S]*?\[\/(?:carousel|previewyoutube|youtube|video|img)\]/gi,
    ""
  );
  text = text.replace(/\[(?:carousel|previewyoutube|youtube|video|img)[^\]]*\]/gi, "");

  text = text.replace(
    /\[url=(.+?)\]([\s\S]*?)\[\/url\]/gi,
    (_match, url, label) => `<a href="${String(url).trim().replace(/^['"]|['"]$/g, "")}">${label}</a>`
  );
  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, "<a href=\"$1\">$1</a>");

  text = text.replace(/\[h([1-6])\]([\s\S]*?)\[\/h\1\]/gi, "<h$1>$2</h$1>");
  text = text.replace(/\[p\]/gi, "<p>").replace(/\[\/p\]/gi, "</p>");
  text = text.replace(/\[(?:list|olist)\]/gi, (match) =>
    match.toLowerCase() === "[olist]" ? "<ol>" : "<ul>"
  );
  text = text.replace(/\[\/olist\]/gi, "</ol>").replace(/\[\/list\]/gi, "</ul>");
  text = text.replace(/\[\*\]/g, "<li>").replace(/\[\/\*\]/g, "</li>");
  text = text.replace(/\[hr\]/gi, "<hr>");
  text = text.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, "<blockquote>$1</blockquote>");
  text = text.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, "<pre><code>$1</code></pre>");
  text = text.replace(/\[(?:table|tbody)\]/gi, "<table>");
  text = text.replace(/\[\/(?:table|tbody)\]/gi, "</table>");
  text = text.replace(/\[tr\]/gi, "<tr>").replace(/\[\/tr\]/gi, "</tr>");
  text = text.replace(/\[(th|td)\]/gi, "<$1>").replace(/\[\/(th|td)\]/gi, "</$1>");

  text = text.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>");
  text = text.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>");
  text = text.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>");
  text = text.replace(/\[(?:strike|s)\]([\s\S]*?)\[\/(?:strike|s)\]/gi, "<del>$1</del>");
  text = text.replace(/\[(?:color|size)(?:=[^\]]+)?\]([\s\S]*?)\[\/(?:color|size)\]/gi, "$1");
  text = text.replace(/\[(?:center|noparse)\]([\s\S]*?)\[\/(?:center|noparse)\]/gi, "$1");

  text = text.replace(
    /^\s*\[\s*([A-Z0-9][A-Z0-9 _-]{1,60})\s*\]\s*$/gm,
    "<h2>$1</h2>"
  );

  return text.replace(/\[(?:\/?)[a-z][a-z0-9]*(?:=[^\]]+)?\]/gi, "");
}

function isOfficialSteamAnnouncement(item) {
  const feedName = String(item.feedname ?? "").toLowerCase();
  if (feedName === OFFICIAL_FEED) return true;
  const url = String(item.url ?? "").toLowerCase();
  return url.includes(`/news/externalpost/${OFFICIAL_FEED}/`);
}

export async function fetchNewsForApp(appId, apiKey) {
  const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
  url.searchParams.set("appid", String(appId));
  url.searchParams.set("count", String(NEWS_FETCH_COUNT));
  url.searchParams.set("maxlength", "0");
  if (apiKey) url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam API error ${res.status} for app ${appId}`);
  const payload = await res.json();
  return payload?.appnews?.newsitems ?? [];
}

export async function fetchRssNewsForApp(appId) {
  const url = new URL(`https://store.steampowered.com/feeds/news/app/${appId}/`);
  url.searchParams.set("l", RSS_LANGUAGE);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam RSS error ${res.status} for app ${appId}`);

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
  if (!res.ok) throw new Error(`Steam Store API error ${res.status} for app ${appId}`);
  const payload = await res.json();
  const entry = payload?.[appId]?.data;
  return entry?.name || null;
}

export function filterNewsItems(items, mode) {
  if (mode === "all") return items;
  return items.filter((item) => {
    if (!isOfficialSteamAnnouncement(item)) return false;
    const type = String(item.newsitemtype ?? "");
    const title = String(item.title ?? "");
    return PATCH_REGEX.test(type) || PATCH_REGEX.test(title);
  });
}

export function stripRssHtml(input) {
  return convertHtmlToDiscordMarkdown(input);
}

export function stripSteamMarkup(input) {
  if (!input) return "";
  return convertHtmlToDiscordMarkdown(convertSteamBbcodeToHtml(input));
}
