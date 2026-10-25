const custom = `https://www.astralcodexten.com/feed
https://www.theintrinsicperspective.com/feed
https://www.experimental-history.com/feed
https://www.henrikkarlsson.xyz/feed
https://www.honest-broker.com/feed
https://www.gurwinder.blog/feed
https://www.ian-leslie.com/feed
https://contraptions.venkateshrao.com/feed
https://www.elysian.press/feed
https://www.themarginalian.org/feed
https://austinkleon.com/feed/
https://nesslabs.com/feed
https://fs.blog/feed/
https://aeon.co/feed.rss
https://psyche.co/feed
https://craigmod.com/index.xml
https://craigmod.com/feed.xml
https://rolfpotts.com/feed/
https://waitbutwhy.com/feed
https://www.overcomingbias.com/feed
https://www.strangeloopcanon.com/feed
https://www.dwarkesh.com/feed
https://www.noemamag.com/feed/
https://thepointmag.com/feed/
https://nautil.us/feed/
https://every.to/feed
https://blog.ayjay.org/feed/
https://www.personalcanon.com/feed
https://www.joanwestenberg.com/feed
https://www.robkhenderson.com/feed
https://www.lesswrong.com/feed.xml
https://www.newyorker.com/feed/culture/personal-history
https://longreads.com/feed/
https://www.atlasobscura.com/feeds/latest`.split("\n");
const subs = ["theconvivialsociety","chrisarnade","jedidiahjenkins","sashachapin","kneelingbus","samkriss","cosmosinstitute","philosophybear","defaultfriend","freddiedeboer","adamgrant","importai"];
const UAS = {
  browser: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  feedly: "Feedly/1.0 (+http://www.feedly.com/fetcher.html; 1 subscribers)",
  none: null,
};
async function hit(url, ua) {
  try {
    const h = { Accept: "application/rss+xml, application/xml, text/xml, */*" };
    if (ua) h["User-Agent"] = ua;
    const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(15000), redirect: "follow" });
    const t = await r.text();
    const items = (t.match(/<item[\s>]|<entry[\s>]|"title"/g) || []).length;
    return `${r.status} items=${items} len=${t.length}`;
  } catch (e) { return `ERR ${e.message}`; }
}
console.log("== custom domains (browser UA)");
for (const u of custom) console.log(u, "->", await hit(u, UAS.browser));
console.log("== substack subdomains, routes");
for (const s of subs) {
  const f = `https://${s}.substack.com/feed`;
  console.log(s);
  console.log("  direct/browser", await hit(f, UAS.browser));
  console.log("  direct/feedly ", await hit(f, UAS.feedly));
  console.log("  direct/none   ", await hit(f, null));
  console.log("  api archive   ", await hit(`https://${s}.substack.com/api/v1/archive?sort=new&limit=5`, UAS.browser));
  console.log("  rss2json      ", await hit(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(f)}`, UAS.browser));
  console.log("  allorigins    ", await hit(`https://api.allorigins.win/raw?url=${encodeURIComponent(f)}`, UAS.browser));
  console.log("  jina          ", await hit(`https://r.jina.ai/${f}`, UAS.browser));
  console.log("  rsshub        ", await hit(`https://rsshub.app/substack/${s}`, UAS.browser));
}
