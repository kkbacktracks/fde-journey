// Daily content job: picks one article for today and refreshes the Claude changelog.
// Runs in GitHub Actions (see .github/workflows/daily-content.yml) or locally with `node scripts/update-content.mjs`.
import { readFile, writeFile } from "node:fs/promises";

const DATA = new URL("../data/", import.meta.url);
const TZ = process.env.SITE_TZ || "America/Los_Angeles";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

const readJson = async (name, fallback) => {
  try { return JSON.parse(await readFile(new URL(name, DATA), "utf8")); } catch { return fallback; }
};
const writeJson = (name, value) => writeFile(new URL(name, DATA), JSON.stringify(value, null, 2) + "\n");

async function fetchText(url, ms = 15000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { "user-agent": "fde-journey-site/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// ---------- roadmap position ----------

function currentPhase(roadmap) {
  const days = Math.floor((Date.parse(today) - Date.parse(roadmap.startDate)) / 86400000);
  const week = Math.max(0, Math.floor(days / 7));
  let i = 0;
  for (const phase of roadmap.phases) {
    if (week < i + phase.weeks.length) return { phase, week: phase.weeks[week - i] };
    i += phase.weeks.length;
  }
  const last = roadmap.phases.at(-1);
  return { phase: last, week: last.weeks.at(-1) };
}

// ---------- daily read ----------

const decode = (s = "") => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&#8217;/g, "'")
  .replace(/\s+/g, " ").trim();

const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1];

function parseFeed(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    const link = decode(tag(b, "link")) || b.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] || b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const date = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const body = decode(tag(b, "content:encoded") || tag(b, "content") || tag(b, "description") || "");
    return {
      title: decode(tag(b, "title")),
      url: link?.trim(),
      summary: decode(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400),
      published: date ? new Date(decode(date)).toISOString() : null,
      source: feed.name,
      tag: feed.tag,
      weight: feed.weight ?? 1,
      length: body.length,
    };
  }).filter((x) => x.title && x.url?.startsWith("http"));
}

const KEYWORDS = /\b(agent|agents|eval|evals|rag|retrieval|llm|prompt|mcp|claude|inference|embedding|fine-tun|distributed|scal|database|architecture|consisten|queue|cache|latency|reliab|postmortem|migration|system design)/i;

// News digests, podcasts and link lists are rarely worth a focused hour.
const ROUNDUP = /\b(podcast|episode|roundup|round-up|links|this week|weekly|digest|issue #?\d+|#\d+|sponsor|giveaway|announcing|hiring)\b/i;

function score(item, phaseTag) {
  const ageDays = (Date.now() - Date.parse(item.published)) / 86400000;
  let s = item.weight * Math.max(0.2, 1 - ageDays / 21);
  if (item.tag === phaseTag || (phaseTag === "fde" && item.tag === "ai")) s *= 1.3;
  if (KEYWORDS.test(item.title + " " + item.summary)) s *= 1.4;
  if (item.title.length < 20) s *= 0.7; // short link posts are rarely deep reads
  if (ROUNDUP.test(item.title)) s *= 0.4;
  return s;
}

async function askClaude(candidates, phase, week, kind) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const { z } = await import("zod");
  const Pick = z.object({ index: z.number().int(), why: z.string() });
  const client = new Anthropic();
  const list = candidates.map((c, i) => `${i}. [${c.source}] ${c.title}\n   ${c.summary}`).join("\n");
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(Pick) },
    messages: [{
      role: "user",
      content: `I'm a software engineer with 4+ years of experience studying to become a forward deployed engineer. This week I'm in the "${phase.title}" phase, studying "${week.title}". Pick the ONE ${kind} below that is most worth an hour of my time today: substantive, practical, not news or a link roundup. Prefer pieces relevant to my current phase. Return its index and a two-sentence "why read this" addressed to me.\n\n${list}`,
    }],
  });
  const pick = response.parsed_output;
  if (!pick || !candidates[pick.index]) return null;
  return { ...candidates[pick.index], why: pick.why, pickedBy: "claude" };
}

async function isReachable(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch { return false; }
}

// One pick a day from a list of feeds. Used for the daily read (blogs) and the Substack of the day.
async function pickDaily(roadmap, { label, kind, picksFile, feedsFile, seedsFile, windowDays = 21, minLength = 0 }) {
  const reads = await readJson(picksFile, []);
  if (reads.some((r) => r.date === today)) {
    console.log(`${label}: already picked for ${today}`);
    return;
  }
  const feeds = await readJson(feedsFile, []);
  const seeds = seedsFile ? await readJson(seedsFile, []) : [];
  const seen = new Set(reads.map((r) => r.url));
  const { phase, week } = currentPhase(roadmap);

  const results = await Promise.allSettled(feeds.map(async (f) => parseFeed(await fetchText(f.url), f)));
  results.forEach((r, i) => r.status === "rejected" && console.warn(`${label} feed failed: ${feeds[i].name}: ${r.reason.message}`));
  results.forEach((r, i) => r.status === "fulfilled" && !r.value.length && console.warn(`${label} feed empty: ${feeds[i].name}`));
  const fresh = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    // minLength skips teaser-only items, which on Substack usually means a paywalled post.
    .filter((x) => x.published && !seen.has(x.url) && x.length >= minLength && Date.now() - Date.parse(x.published) < windowDays * 86400000)
    .map((x) => ({ ...x, score: score(x, phase.tag) }))
    .sort((a, b) => b.score - a.score);

  let pick = null;
  if (fresh.length) {
    try { pick = await askClaude(fresh.slice(0, 15), phase, week, kind); } catch (e) { console.warn(`claude pick failed: ${e.message}`); }
    pick ??= { ...fresh[0], why: `Top-ranked new post from ${fresh[0].source} this week.`, pickedBy: "score" };
  }
  if (!pick) {
    // Quiet day: fall back to an unread classic, preferring the current phase's topic.
    const unread = seeds.filter((s) => !seen.has(s.url));
    const ordered = [...unread.filter((s) => s.tag === phase.tag), ...unread.filter((s) => s.tag !== phase.tag)];
    for (const s of ordered) {
      if (await isReachable(s.url)) { pick = { ...s, pickedBy: "classic" }; break; }
      console.warn(`seed unreachable, skipping: ${s.url}`);
    }
  }
  if (!pick) return console.warn(`${label}: nothing to pick today`);

  const { title, url, source, tag: t, why, pickedBy } = pick;
  reads.unshift({ date: today, title, url, source, tag: t, why, pickedBy });
  await writeJson(picksFile, reads);
  console.log(`${label}: ${title} (${source}, ${pickedBy})`);
}

// ---------- Claude changelog ----------

async function updateChangelog() {
  const log = await readJson("changelog.json", { updated: null, claudeCode: [], platform: [] });

  try {
    const md = await fetchText("https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md");
    const known = new Map(log.claudeCode.map((e) => [e.version, e]));
    const sections = md.split(/^## /m).slice(1, 21);
    log.claudeCode = sections.map((s) => {
      const [head, ...body] = s.split("\n");
      const version = head.trim();
      const items = body.filter((l) => /^\s*[-*] /.test(l)).map((l) => l.replace(/^\s*[-*] /, "").trim());
      return { version, firstSeen: known.get(version)?.firstSeen ?? today, items };
    });
  } catch (e) { console.warn(`claude code changelog failed: ${e.message}`); }

  try {
    const md = await fetchText("https://docs.claude.com/en/release-notes/overview.md");
    const sections = md.split(/^### /m).slice(1);
    const byDate = new Map();
    for (const s of sections) {
      const [head, ...body] = s.split("\n");
      const date = new Date(head.trim() + " UTC");
      if (Number.isNaN(date.getTime())) continue;
      const key = date.toISOString().slice(0, 10);
      const items = body.filter((l) => /^\s*\* /.test(l)).map((l) => l.replace(/^\s*\* /, "").trim());
      byDate.set(key, [...(byDate.get(key) ?? []), ...items]);
    }
    log.platform = [...byDate].slice(0, 20).map(([date, items]) => ({ date, items }));
  } catch (e) { console.warn(`platform release notes failed: ${e.message}`); }

  log.updated = today;
  await writeJson("changelog.json", log);
  console.log(`changelog: ${log.claudeCode.length} Claude Code versions, ${log.platform.length} platform days`);
}

const roadmap = await readJson("roadmap.json");
await pickDaily(roadmap, { label: "read", kind: "article", picksFile: "reads.json", feedsFile: "feeds.json", seedsFile: "seed-reads.json" });
await pickDaily(roadmap, { label: "substack", kind: "Substack post", picksFile: "substack-reads.json", feedsFile: "substacks.json", windowDays: 30, minLength: 3000 });
await updateChangelog();
