// Checks every resource link in the roadmap and the classics list. Run by .github/workflows/check-links.yml.
import { readFile } from "node:fs/promises";

const roadmap = JSON.parse(await readFile(new URL("../data/roadmap.json", import.meta.url), "utf8"));
const seeds = JSON.parse(await readFile(new URL("../data/seed-reads.json", import.meta.url), "utf8"));
const urls = new Set(seeds.map((s) => s.url));
for (const p of roadmap.phases) for (const w of p.weeks) for (const t of w.tasks) for (const r of t.resources ?? []) urls.add(r.url);

// Sites that block bots answer 403/429 even when the page is fine; report them separately.
const BOT_WALLS = [403, 429, 999];
const results = await Promise.all([...urls].map(async (url) => {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": "Mozilla/5.0 (link check)" } });
    return { url, status: res.status };
  } catch (e) { return { url, status: `error: ${e.cause?.code || e.message}` }; }
}));

const broken = results.filter((r) => typeof r.status !== "number" || (r.status >= 400 && !BOT_WALLS.includes(r.status)));
const walled = results.filter((r) => BOT_WALLS.includes(r.status));
console.log(`checked ${results.length} links: ${results.length - broken.length - walled.length} ok, ${walled.length} bot-walled, ${broken.length} broken`);
for (const r of walled) console.log(`WALLED ${r.status} ${r.url}`);
for (const r of broken) console.log(`BROKEN ${r.status} ${r.url}`);
if (broken.length) process.exit(1);
