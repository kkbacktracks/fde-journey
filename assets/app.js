// FDE Journey: a static single-page site. Content lives in data/*.json, progress in localStorage.

const STORE_KEY = "fde-journey-progress-v1";
const QUOTES = [
  "One hour a day for 6 months is 182 hours. That's a career change.",
  "Consistency beats intensity. Show up today.",
  "Build things customers would pay for, then write about how you did it.",
  "You don't need to feel ready. You need to finish today's hour.",
  "Every senior engineer was once confused by consensus algorithms.",
  "Small daily wins compound. Protect the streak.",
  "The best FDEs learn fast in unfamiliar territory. Practice that today.",
];

// ---------- state ----------

const blank = () => ({ checkins: {}, tasks: {}, challenges: {}, readsDone: {} });
function load() {
  try { return { ...blank(), ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { return blank(); }
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { toast("Couldn't save progress in this browser"); }
}

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Inline markdown used by the changelogs: links and `code`.
const md = (s = "") => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
const fmtDate = (iso, opts = { month: "short", day: "numeric" }) => parseDay(iso).toLocaleDateString(undefined, opts);

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

async function getJson(path, fallback) {
  try {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch { return fallback; }
}

// ---------- data ----------

let roadmap, reads, substackReads, seeds, changelog, weeks;

async function loadData() {
  [roadmap, reads, substackReads, seeds, changelog] = await Promise.all([
    getJson("data/roadmap.json", null),
    getJson("data/reads.json", []),
    getJson("data/substack-reads.json", []),
    getJson("data/seed-reads.json", []),
    getJson("data/changelog.json", { claudeCode: [], platform: [] }),
  ]);
  // Flatten weeks so each has a global index, its phase color and stable ids for tasks and challenges.
  weeks = [];
  roadmap.phases.forEach((phase, p) => {
    phase.color = `var(--p${p + 1})`;
    phase.weeks.forEach((w, i) => weeks.push({ ...w, phase, n: weeks.length + 1, id: `${phase.id}-w${i + 1}` }));
  });
}

const today = () => localISO();
const totalDays = () => weeks.length * 7;
const dayNumber = () => daysBetween(roadmap.startDate, today()) + 1;
function currentWeek() {
  const idx = Math.floor((dayNumber() - 1) / 7);
  return weeks[Math.min(Math.max(idx, 0), weeks.length - 1)];
}
const weekStart = (w) => localISO(addDays(parseDay(roadmap.startDate), (w.n - 1) * 7));
const taskId = (w, i) => `${w.id}-t${i + 1}`;
const weekDone = (w) => w.tasks.filter((_, i) => state.tasks[taskId(w, i)]).length;
const pad2 = (n) => String(n).padStart(2, "0");

function streak() {
  let n = 0;
  let d = new Date();
  if (!state.checkins[localISO(d)]) d = addDays(d, -1); // today not done yet doesn't break the streak
  while (state.checkins[localISO(d)]) { n++; d = addDays(d, -1); }
  return n;
}
function longestStreak() {
  const days = Object.keys(state.checkins).sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
const hours = () => Object.values(state.checkins).reduce((s, c) => s + (c.minutes || 60), 0) / 60;
function overallProgress() {
  const total = weeks.reduce((s, w) => s + w.tasks.length, 0);
  return total ? Object.values(state.tasks).filter(Boolean).length / total : 0;
}
const labelTag = (t) => ({ ai: "AI engineering", "system-design": "System design", fde: "FDE", tech: "Tech" }[t] || t || "");

function todaysRead() {
  const exact = reads.find((r) => r.date === today());
  if (exact) return exact;
  // Before the daily job has run today, rotate through the classics so there's always something to read.
  const done = new Set(reads.map((r) => r.url));
  const pool = seeds.filter((s) => !done.has(s.url));
  const list = pool.length ? pool : seeds;
  return list.length ? { ...list[Math.abs(dayNumber()) % list.length], date: today(), pickedBy: "classic" } : null;
}
// The Substack pick has no fallback list, so show the latest one until a new one lands.
const todaysSubstack = () => substackReads[0] || null;

// Tasks are { task, resources: [{ title, url }] }; plain strings still work.
const taskText = (t) => (typeof t === "string" ? t : t.task);
const taskResources = (t) => (typeof t === "string" ? [] : t.resources || []);
const resourceLinks = (list) => list.length
  ? `<div class="resources">${list.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>`).join("")}</div>`
  : "";

function todaysFocus(w) {
  const dow = new Date().getDay(); // 0 Sunday, 6 Saturday
  if (dow === 6) return { kind: "Challenge day", text: w.challenge };
  const i = w.tasks.findIndex((_, i) => !state.tasks[taskId(w, i)]);
  if (dow === 0) {
    return i === -1
      ? { kind: "Review day", text: "Review the week, write your notes, and catch up on reads." }
      : { kind: "Review day · catch up", text: taskText(w.tasks[i]), index: i, resources: taskResources(w.tasks[i]) };
  }
  return i === -1
    ? { kind: "Ahead of schedule", text: `All of this week's tasks are done. Start the challenge: ${w.challenge}` }
    : { kind: `Today's mission · task ${i + 1} of ${w.tasks.length}`, text: taskText(w.tasks[i]), index: i, resources: taskResources(w.tasks[i]) };
}

// ---------- views ----------

function journeyTrack() {
  const cur = currentWeek();
  const started = dayNumber() >= 1;
  const cells = weeks.map((w) => {
    const cls = [w === cur && started ? "now" : "", weekDone(w) === w.tasks.length ? "full" : "", started && w.n < cur.n ? "past" : ""].join(" ");
    return `<span class="wk ${cls}" style="--c:${w.phase.color}" title="Week ${w.n} · ${esc(w.title)} · ${weekDone(w)}/${w.tasks.length} done"></span>`;
  }).join("");
  const short = ["System design", "LLM apps", "Agents", "FDE role"];
  const labels = roadmap.phases.map((p, i) => `<span style="--c:${p.color};grid-column:span ${p.weeks.length}"><span class="long">${esc(p.title)}</span><span class="short">${short[i] || esc(p.title)}</span></span>`).join("");
  return `
    <section class="journey" aria-label="26-week journey">
      <div class="track-meta"><span>${fmtDate(roadmap.startDate)}</span><span><b>Week ${cur.n}</b> of ${weeks.length}</span><span>${fmtDate(localISO(addDays(parseDay(roadmap.startDate), totalDays() - 1)))}</span></div>
      <div class="track">${cells}</div>
      <div class="track-labels" style="grid-template-columns:repeat(${weeks.length},1fr)">${labels}</div>
    </section>`;
}

function card(read, kind) {
  if (!read) {
    return `<article class="card clip ${kind}"><div class="masthead"><span class="badge">S</span>Substack of the day</div>
      <p class="empty" style="margin-top:.8rem">The first Substack pick lands with tomorrow's 6:00 update.</p></article>`;
  }
  const isToday = read.date === today();
  const label = kind === "substack" ? (isToday ? "Substack of the day" : `Substack pick · ${fmtDate(read.date)}`) : "Today's read";
  return `
    <article class="card clip ${kind}">
      <div class="masthead"><span class="badge">${kind === "substack" ? "S" : "R"}</span>${label}<span class="spacer"></span><span class="tag ${esc(read.tag)}">${labelTag(read.tag)}</span></div>
      <a class="title" href="${esc(read.url)}" target="_blank" rel="noopener">${esc(read.title)}</a>
      <div class="source">${esc(read.source)}</div>
      ${read.why ? `<p class="why">${esc(read.why)}</p>` : ""}
      <div class="foot"><a href="${esc(read.url)}" target="_blank" rel="noopener">Read it →</a><span class="spacer"></span>
        <label class="check"><input type="checkbox" data-read="${esc(read.url)}" ${state.readsDone[read.url] ? "checked" : ""}> Done</label></div>
    </article>`;
}

function viewToday() {
  const w = currentWeek();
  const day = dayNumber();
  const focus = todaysFocus(w);
  const checked = state.checkins[today()];
  const latest = changelog.claudeCode?.[0];
  const quote = QUOTES[Math.abs(day) % QUOTES.length];
  const notStarted = day < 1;
  const last14 = Array.from({ length: 14 }, (_, i) => localISO(addDays(new Date(), i - 13)));

  return `
    <section class="hero">
      <div class="daycount">
        <span class="num">${notStarted ? `T–${1 - day}` : pad2(day)}</span>
        <span class="of">${notStarted ? `DAYS UNTIL ${fmtDate(roadmap.startDate).toUpperCase()}` : `DAY OF ${totalDays()}`}</span>
      </div>
      <div>
        <div class="kicker"><span class="dot"></span>Week ${w.n} · ${esc(w.phase.title)}</div>
        <h1>Forward deployed engineer, <em>ready by April 2027.</em></h1>
        <p class="quote">${esc(quote)}</p>
      </div>
    </section>

    ${journeyTrack()}

    <section class="stats">
      <div><div class="v">${streak()}<small>days</small></div><div class="l">Streak</div></div>
      <div><div class="v">${longestStreak()}</div><div class="l">Best streak</div></div>
      <div><div class="v">${hours().toFixed(0)}<small>h</small></div><div class="l">Invested</div></div>
      <div><div class="v">${Math.round(overallProgress() * 100)}<small>%</small></div><div class="l">Roadmap done</div></div>
      <div><div class="v">${Math.max(0, totalDays() - Math.max(day, 0))}</div><div class="l">Days to go</div></div>
    </section>

    <section class="today-grid">
      <div class="stack">
        <article class="mission" style="--c:${w.phase.color}">
          <div class="kicker">${esc(focus.kind)}</div>
          <div class="task">${esc(focus.text)}</div>
          ${focus.resources?.length ? `<div class="label">Learn it from</div>${resourceLinks(focus.resources)}` : ""}
          <div class="actions">
            ${focus.index !== undefined ? `<button class="btn" data-task="${taskId(w, focus.index)}">Mark done</button>` : ""}
            <a class="btn ghost" href="#roadmap">Week ${w.n}: ${esc(w.title)}</a>
            <span class="week-dots" title="${weekDone(w)} of ${w.tasks.length} done this week">${w.tasks.map((_, i) => `<i class="${state.tasks[taskId(w, i)] ? "on" : ""}"></i>`).join("")}</span>
          </div>
        </article>

        <article class="card checkin">
          <div class="row"><h3>Daily check-in</h3><span class="spacer"></span><span class="kicker">Last 14 days</span></div>
          <div class="streak-row">${last14.map((d) => `<i class="${state.checkins[d] ? "on" : ""} ${d === today() ? "today" : ""}" title="${fmtDate(d)}"></i>`).join("")}</div>
          <textarea id="note" placeholder="What did you learn or build today? One or two lines is plenty.">${esc(checked?.note || "")}</textarea>
          <div class="row" style="margin-top:.75rem">
            <select id="minutes" style="width:auto">
              ${[30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${(checked?.minutes || 60) === m ? "selected" : ""}>${m} min</option>`).join("")}
            </select>
            <span class="spacer"></span>
            <button class="btn ${checked ? "done" : ""}" id="checkin">${checked ? "✓ Checked in · update" : "I did my hour"}</button>
          </div>
        </article>
      </div>

      <div class="stack">
        <div class="desk-head"><h2 class="section-title">The reading desk</h2><a class="kicker" href="#reads">Archive</a></div>
        ${card(todaysRead(), "read")}
        ${card(todaysSubstack(), "substack")}
        ${latest ? `
        <div class="term">
          <div class="bar"><i></i><i></i><i></i></div>
          <div class="prompt">$ claude --version <b>${esc(latest.version)}</b></div>
          <ul>${latest.items.slice(0, 3).map((i) => `<li>${md(i)}</li>`).join("")}</ul>
          <a href="#changelog">→ all Claude updates</a>
        </div>` : ""}
      </div>
    </section>`;
}

function viewRoadmap() {
  const cur = currentWeek();
  return `
    <section class="page-head">
      <div class="kicker"><span class="dot"></span>26 weeks · 130 one-hour tasks</div>
      <h1>The <em>roadmap</em></h1>
      <p>Weekdays are study, Saturday is the challenge, Sunday is review. ${dayNumber() < 1 ? "Starts" : "Started"} ${fmtDate(roadmap.startDate, { month: "long", day: "numeric", year: "numeric" })}.</p>
    </section>
    ${journeyTrack()}
    ${roadmap.phases.map((phase, p) => {
      const pw = weeks.filter((w) => w.phase === phase);
      const total = pw.reduce((s, w) => s + w.tasks.length, 0);
      const done = pw.reduce((s, w) => s + weekDone(w), 0);
      return `
      <details class="phase" style="--c:${phase.color}" ${pw.includes(cur) ? "open" : ""}>
        <summary>
          <span class="numeral">${pad2(p + 1)}</span>
          <div>
            <h2>${esc(phase.title)}</h2>
            <div class="meta"><span>${esc(phase.months)}</span><span>${pw.length} weeks</span><span>${done}/${total} done</span></div>
            <div class="bar"><span style="width:${(done / total) * 100}%"></span></div>
          </div>
        </summary>
        <div class="phase-body">
          ${phase.why ? `<p class="why">${esc(phase.why)}</p>` : ""}
          <div class="gate"><b>Gate</b>${esc(phase.gate)}</div>
          ${pw.map((w) => `
            <div class="week ${w === cur ? "current" : ""} ${weekDone(w) === w.tasks.length ? "complete" : ""}" id="${w.id}">
              <div class="week-head"><span class="wn">Week ${pad2(w.n)}</span><h3>${esc(w.title)}</h3>${w === cur ? '<span class="tag signal">This week</span>' : ""}<span class="date">${fmtDate(weekStart(w))}</span></div>
              <ul class="checklist">
                ${w.tasks.map((t, i) => { const id = taskId(w, i); return `<li><input type="checkbox" id="${id}" data-task="${id}" ${state.tasks[id] ? "checked" : ""}><div><label for="${id}" class="${state.tasks[id] ? "done" : ""}">${esc(taskText(t))}</label>${resourceLinks(taskResources(t))}</div></li>`; }).join("")}
                <li class="sat"><span class="tag fde">Sat</span><span>${esc(w.challenge)}</span></li>
              </ul>
            </div>`).join("")}
        </div>
      </details>`;
    }).join("")}`;
}

function viewChallenges() {
  const cur = currentWeek();
  const upto = weeks.filter((w) => w.n <= cur.n + 1);
  const statuses = ["Not started", "In progress", "Done", "Skipped"];
  const doneCount = weeks.filter((w) => state.challenges[w.id]?.status === "Done").length;
  return `
    <section class="page-head">
      <div class="kicker"><span class="dot"></span>${doneCount} of ${weeks.length} done</div>
      <h1>Saturday <em>challenges</em></h1>
      <p>Link what you built so this page becomes your portfolio.</p>
    </section>
    <div class="card"><ul class="list">
      ${upto.slice().reverse().map((w) => {
        const c = state.challenges[w.id] || {};
        return `<li class="challenge">
          <div>
            <div class="kicker">Week ${pad2(w.n)} · ${esc(w.title)} ${w === cur ? '<span class="tag signal">This week</span>' : ""}</div>
            <div class="text">${esc(w.challenge)}</div>
            <input type="url" placeholder="Link to your write-up, repo or demo" value="${esc(c.link || "")}" data-challenge-link="${w.id}">
          </div>
          <select data-challenge-status="${w.id}">${statuses.map((s) => `<option ${(c.status || "Not started") === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </li>`;
      }).join("")}
    </ul></div>
    <p class="muted small">Future challenges unlock as you reach their week. They're all on the <a href="#roadmap">roadmap</a>.</p>`;
}

function viewLog() {
  const start = parseDay(roadmap.startDate);
  // Align the grid to start on a Sunday so rows are weekdays.
  const gridStart = addDays(start, -start.getDay());
  const cells = [];
  const end = addDays(start, totalDays());
  for (let d = gridStart; d < end; d = addDays(d, 1)) {
    const iso = localISO(d);
    const cls = [state.checkins[iso] ? "on" : "", iso === today() ? "today" : "", iso > today() ? "future" : ""].join(" ");
    cells.push(`<span class="${cls}" title="${fmtDate(iso)}${state.checkins[iso] ? " · checked in" : ""}"></span>`);
  }
  const entries = Object.entries(state.checkins).sort(([a], [b]) => b.localeCompare(a));
  return `
    <section class="page-head">
      <div class="kicker"><span class="dot"></span>${entries.length} check-ins · ${hours().toFixed(1)} hours · ${streak()}-day streak</div>
      <h1>The <em>log</em></h1>
      <p>Every hour you put in, and what you learned from it.</p>
    </section>
    <div class="card" style="margin-bottom:1.25rem"><div class="heatmap">${cells.join("")}</div></div>
    <div class="card">
      ${entries.length ? `<ul class="list">${entries.map(([d, c]) => `
        <li><div class="row"><span class="entry-date">${fmtDate(d, { weekday: "short", month: "short", day: "numeric" })} · ${c.minutes || 60} min</span><span class="spacer"></span><button class="link small muted" data-uncheck="${d}">Remove</button></div>
        <div class="entry-note">${c.note ? esc(c.note) : '<span class="muted">No note</span>'}</div></li>`).join("")}</ul>`
      : '<p class="empty">No check-ins yet. Do your first hour and check in on the <a href="#today">Today</a> page.</p>'}
    </div>`;
}

let readTab = "daily";
let readFilter = "all";
function readRows(list, dateLabel = (r) => fmtDate(r.date)) {
  return list.map((r) => `<li class="read-row">
    <div class="d">${dateLabel(r)}</div>
    <div>
      <div class="row small"><span class="muted">${esc(r.source)}</span><span class="tag ${esc(r.tag)}">${labelTag(r.tag)}</span></div>
      <a class="t" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
      ${r.why ? `<div class="small muted">${esc(r.why)}</div>` : ""}
      <label class="check small" style="margin-top:.4rem"><input type="checkbox" data-read="${esc(r.url)}" ${state.readsDone[r.url] ? "checked" : ""}> Read</label>
    </div>
  </li>`).join("");
}
function viewReads() {
  const daily = [...reads];
  const t = todaysRead();
  if (t && !daily.some((r) => r.url === t.url)) daily.unshift(t);
  const all = [...daily, ...substackReads];
  const doneCount = all.filter((r) => state.readsDone[r.url]).length;
  let body;
  if (readTab === "daily") {
    const shown = daily.filter((r) => readFilter === "all" || r.tag === readFilter);
    body = `<div class="tabs">${["all", "ai", "system-design", "fde"].map((f) => `<button data-filter="${f}" class="${readFilter === f ? "active" : ""}">${f === "all" ? "All topics" : labelTag(f)}</button>`).join("")}</div>
      <div class="card"><ul class="list">${readRows(shown) || '<li class="empty">Nothing here yet.</li>'}</ul></div>`;
  } else if (readTab === "substack") {
    body = `<div class="card"><ul class="list">${readRows(substackReads) || '<li class="empty">The first Substack pick lands with tomorrow\'s 6:00 update.</li>'}</ul></div>`;
  } else {
    body = `<div class="card"><ul class="list">${readRows(seeds, () => "Classic")}</ul></div>`;
  }
  return `
    <section class="page-head">
      <div class="kicker"><span class="dot"></span>${doneCount} read so far</div>
      <h1>The reading <em>desk</em></h1>
      <p>One hand-picked article for the roadmap and one deep Substack read a day, rotating through philosophy, creativity, intelligence, travel and thinking, plus the classics worth reading once.</p>
    </section>
    <div class="tabs">
      <button data-readtab="daily" class="${readTab === "daily" ? "active" : ""}">Daily reads (${daily.length})</button>
      <button data-readtab="substack" class="${readTab === "substack" ? "active" : ""}">Substack (${substackReads.length})</button>
      <button data-readtab="classics" class="${readTab === "classics" ? "active" : ""}">Classics (${seeds.length})</button>
    </div>
    ${body}`;
}

let changelogTab = "code";
function viewChangelog() {
  const code = changelog.claudeCode || [];
  const platform = changelog.platform || [];
  return `
    <section class="page-head">
      <div class="kicker"><span class="dot"></span>Refreshed daily${changelog.updated ? ` · last ${fmtDate(changelog.updated)}` : ""}</div>
      <h1>Claude <em>changelog</em></h1>
      <p>What changed in Claude Code and the Claude Platform, from the official sources.</p>
    </section>
    <div class="tabs">
      <button data-cltab="code" class="${changelogTab === "code" ? "active" : ""}">Claude Code</button>
      <button data-cltab="platform" class="${changelogTab === "platform" ? "active" : ""}">Platform and API</button>
    </div>
    <div class="card"><ul class="list">
      ${changelogTab === "code"
        ? code.map((v) => `<li class="release"><div class="row"><h3>v${esc(v.version)}</h3><span class="muted small mono">seen ${fmtDate(v.firstSeen)}</span></div><ul class="changes">${v.items.map((i) => `<li>${md(i)}</li>`).join("")}</ul></li>`).join("")
        : platform.map((d) => `<li class="release"><h3>${fmtDate(d.date, { month: "long", day: "numeric", year: "numeric" })}</h3><ul class="changes">${d.items.map((i) => `<li>${md(i)}</li>`).join("")}</ul></li>`).join("")}
    </ul></div>
    <p class="muted small">Sources: <a href="https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Claude Code CHANGELOG.md</a> · <a href="https://platform.claude.com/docs/en/release-notes/overview" target="_blank" rel="noopener">Claude Platform release notes</a></p>`;
}

// ---------- routing and events ----------

const ROUTES = { today: viewToday, roadmap: viewRoadmap, challenges: viewChallenges, log: viewLog, reads: viewReads, changelog: viewChangelog };

function render(navigated = false) {
  const route = location.hash.slice(1) || "today";
  const view = ROUTES[route] || viewToday;
  $("#app").innerHTML = view();
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${route}`));
  if (!navigated) return; // re-renders after a click keep the scroll position
  if (route === "roadmap") document.querySelector(".week.current")?.scrollIntoView({ block: "center" });
  else window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.matches("button[data-task]")) { state.tasks[t.dataset.task] = true; save(); toast("Nice. Task done."); render(); }
  if (t.id === "checkin") {
    state.checkins[today()] = { note: $("#note").value.trim(), minutes: Number($("#minutes").value) };
    save(); toast(`Checked in. Streak: ${streak()} day${streak() === 1 ? "" : "s"}`); render();
  }
  if (t.dataset.uncheck) { delete state.checkins[t.dataset.uncheck]; save(); render(); }
  if (t.dataset.filter) { readFilter = t.dataset.filter; render(); }
  if (t.dataset.cltab) { changelogTab = t.dataset.cltab; render(); }
  if (t.dataset.readtab) { readTab = t.dataset.readtab; render(); }
  if (t.id === "theme") {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("fde-theme", root.dataset.theme); } catch {}
  }
  if (t.id === "export") {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `fde-journey-backup-${today()}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("input[data-task]")) { state.tasks[t.dataset.task] = t.checked; save(); render(); }
  if (t.dataset.read !== undefined) { if (t.checked) state.readsDone[t.dataset.read] = today(); else delete state.readsDone[t.dataset.read]; save(); }
  if (t.dataset.challengeStatus) { (state.challenges[t.dataset.challengeStatus] ??= {}).status = t.value; save(); toast("Saved"); }
  if (t.dataset.challengeLink) { (state.challenges[t.dataset.challengeLink] ??= {}).link = t.value.trim(); save(); toast("Saved"); }
  if (t.id === "import" && t.files[0]) {
    t.files[0].text().then((txt) => {
      try { state = { ...blank(), ...JSON.parse(txt) }; save(); toast("Backup imported"); render(); }
      catch { toast("That file isn't a valid backup"); }
    });
  }
});

window.addEventListener("hashchange", () => render(true));

loadData().then(() => render(true)).catch((err) => {
  $("#app").innerHTML = `<p>Couldn't load the site data. If you opened index.html directly, serve the folder instead (for example <code>npx serve .</code>).</p><p class="muted small">${esc(err.message)}</p>`;
});
