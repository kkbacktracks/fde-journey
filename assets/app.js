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

let roadmap, reads, seeds, changelog, weeks;

async function loadData() {
  [roadmap, reads, seeds, changelog] = await Promise.all([
    getJson("data/roadmap.json", null),
    getJson("data/reads.json", []),
    getJson("data/seed-reads.json", []),
    getJson("data/changelog.json", { claudeCode: [], platform: [] }),
  ]);
  // Flatten weeks so each has a global index and stable ids for tasks and challenges.
  weeks = [];
  roadmap.phases.forEach((phase) => phase.weeks.forEach((w, i) => {
    weeks.push({ ...w, phase, n: weeks.length + 1, id: `${phase.id}-w${i + 1}` });
  }));
}

const today = () => localISO();
const totalDays = () => weeks.length * 7;
const dayNumber = () => daysBetween(roadmap.startDate, today()) + 1;
function currentWeek() {
  const idx = Math.floor((dayNumber() - 1) / 7);
  return weeks[Math.min(Math.max(idx, 0), weeks.length - 1)];
}
const taskId = (w, i) => `${w.id}-t${i + 1}`;
const weekDone = (w) => w.tasks.filter((_, i) => state.tasks[taskId(w, i)]).length;

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

function todaysRead() {
  const exact = reads.find((r) => r.date === today());
  if (exact) return exact;
  // Before the daily job has run today, rotate through the classics so there's always something to read.
  const done = new Set(reads.map((r) => r.url));
  const pool = seeds.filter((s) => !done.has(s.url));
  const list = pool.length ? pool : seeds;
  return list.length ? { ...list[Math.abs(dayNumber()) % list.length], date: today(), pickedBy: "classic" } : null;
}

// Tasks are { task, resources: [{ title, url }] }; plain strings still work.
const taskText = (t) => (typeof t === "string" ? t : t.task);
const taskResources = (t) => (typeof t === "string" ? [] : t.resources || []);
const resourceLinks = (list, cls = "resources") => list.length
  ? `<div class="${cls}">${list.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>`).join("")}</div>`
  : "";

function todaysFocus(w) {
  const dow = new Date().getDay(); // 0 Sunday, 6 Saturday
  if (dow === 6) return { kind: "Challenge day", text: w.challenge };
  if (dow === 0) {
    const i = w.tasks.findIndex((_, i) => !state.tasks[taskId(w, i)]);
    return i === -1
      ? { kind: "Review day", text: "Review the week, write your notes, and catch up on reads." }
      : { kind: "Review day", text: `Catch up: ${taskText(w.tasks[i])}`, index: i, resources: taskResources(w.tasks[i]) };
  }
  const i = w.tasks.findIndex((_, i) => !state.tasks[taskId(w, i)]);
  return i === -1
    ? { kind: "Ahead of schedule", text: `All of this week's tasks are done. Start the challenge: ${w.challenge}` }
    : { kind: "Today's task", text: taskText(w.tasks[i]), index: i, resources: taskResources(w.tasks[i]) };
}

// ---------- views ----------

function viewToday() {
  const w = currentWeek();
  const day = dayNumber();
  const focus = todaysFocus(w);
  const checked = state.checkins[today()];
  const read = todaysRead();
  const latest = changelog.claudeCode?.[0];
  const quote = QUOTES[Math.abs(day) % QUOTES.length];
  const notStarted = day < 1;

  return `
    <section class="hero">
      <div class="eyebrow">${notStarted ? `Starts ${fmtDate(roadmap.startDate)}` : `Day ${day} of ${totalDays()}`} · Week ${w.n} · ${esc(w.phase.title)}</div>
      <h1>${esc(roadmap.goal)}</h1>
      <p class="quote">${esc(quote)}</p>
    </section>

    <section class="grid grid-4" style="margin-bottom:1rem">
      <div class="card stat"><div class="value">${streak()}</div><div class="label">day streak (best ${longestStreak()})</div></div>
      <div class="card stat"><div class="value">${hours().toFixed(0)}</div><div class="label">hours invested</div></div>
      <div class="card stat"><div class="value">${Math.round(overallProgress() * 100)}%</div><div class="label">roadmap done</div></div>
      <div class="card stat"><div class="value">${Math.max(0, totalDays() - Math.max(day, 0))}</div><div class="label">days to go</div></div>
    </section>

    <section class="grid grid-2">
      <div class="grid">
        <div class="card focus">
          <div class="eyebrow">${focus.kind} · Week ${w.n}: ${esc(w.title)}</div>
          <div class="task">${esc(focus.text)}</div>
          ${focus.resources?.length ? `<div class="eyebrow" style="margin-top:.25rem">Learn it from</div>${resourceLinks(focus.resources)}` : ""}
          <div class="row">
            ${focus.index !== undefined ? `<button class="btn ghost" data-task="${taskId(w, focus.index)}">Mark task done</button>` : ""}
            <a href="#roadmap">See the full week</a>
          </div>
        </div>

        <div class="card">
          <div class="eyebrow">Daily check-in</div>
          <textarea id="note" placeholder="What did you learn or build today? One or two lines is plenty.">${esc(checked?.note || "")}</textarea>
          <div class="row" style="margin-top:.6rem">
            <select id="minutes" style="width:auto">
              ${[30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${(checked?.minutes || 60) === m ? "selected" : ""}>${m} min</option>`).join("")}
            </select>
            <span class="spacer"></span>
            <button class="btn ${checked ? "done" : ""}" id="checkin">${checked ? "Checked in ✓ Update" : "I did my hour"}</button>
          </div>
        </div>
      </div>

      <div class="grid">
        ${read ? `
        <div class="card">
          <div class="eyebrow">Today's read · <span class="pill ${esc(read.tag)}">${labelTag(read.tag)}</span></div>
          <a class="read-title" href="${esc(read.url)}" target="_blank" rel="noopener">${esc(read.title)}</a>
          <div class="muted small">${esc(read.source)}</div>
          ${read.why ? `<p style="margin:.5rem 0">${esc(read.why)}</p>` : ""}
          <label class="row small"><input type="checkbox" data-read="${esc(read.url)}" ${state.readsDone[read.url] ? "checked" : ""}> Read it</label>
        </div>` : ""}

        ${latest ? `
        <div class="card">
          <div class="eyebrow">Latest Claude Code · v${esc(latest.version)}</div>
          <ul class="changes small">${latest.items.slice(0, 4).map((i) => `<li>${md(i)}</li>`).join("")}</ul>
          <a class="small" href="#changelog">All Claude updates</a>
        </div>` : ""}
      </div>
    </section>`;
}

function overallProgress() {
  const total = weeks.reduce((s, w) => s + w.tasks.length, 0);
  return total ? Object.values(state.tasks).filter(Boolean).length / total : 0;
}
const labelTag = (t) => ({ ai: "AI engineering", "system-design": "System design", fde: "FDE" }[t] || t || "");

function viewRoadmap() {
  const cur = currentWeek();
  return `
    <section class="hero"><h1>6-month roadmap</h1><p>Weekdays are study, Saturday is the challenge, Sunday is review. ${dayNumber() < 1 ? "Starts" : "Started"} ${fmtDate(roadmap.startDate, { month: "long", day: "numeric", year: "numeric" })}.</p></section>
    ${roadmap.phases.map((phase) => {
      const pw = weeks.filter((w) => w.phase === phase);
      const total = pw.reduce((s, w) => s + w.tasks.length, 0);
      const done = pw.reduce((s, w) => s + weekDone(w), 0);
      const open = pw.includes(cur);
      return `
      <details class="phase" ${open ? "open" : ""}>
        <summary>
          <div class="row"><h2 style="margin:0">${esc(phase.title)}</h2><span class="pill ${phase.tag}">${labelTag(phase.tag)}</span><span class="spacer"></span><span class="muted small">${esc(phase.months)} · ${done}/${total}</span></div>
          <div class="progress" style="margin-top:.6rem"><span style="width:${(done / total) * 100}%"></span></div>
        </summary>
        <div class="phase-body">
          ${phase.why ? `<p class="muted" style="margin:0 0 .6rem">${esc(phase.why)}</p>` : ""}
          <div class="gate"><strong>Gate:</strong> ${esc(phase.gate)}</div>
          ${pw.map((w) => `
            <div class="week ${w === cur ? "current" : ""}" id="${w.id}">
              <div class="week-head"><strong>Week ${w.n}: ${esc(w.title)}</strong>${w === cur ? '<span class="pill accent">This week</span>' : ""}${weekDone(w) === w.tasks.length ? '<span class="pill good">Done</span>' : ""}<span class="muted small">${fmtDate(localISO(addDays(parseDay(roadmap.startDate), (w.n - 1) * 7)))}</span></div>
              <ul class="checklist">
                ${w.tasks.map((t, i) => { const id = taskId(w, i); return `<li><input type="checkbox" id="${id}" data-task="${id}" ${state.tasks[id] ? "checked" : ""}><div><label for="${id}" class="${state.tasks[id] ? "done" : ""}">${esc(taskText(t))}</label>${resourceLinks(taskResources(t))}</div></li>`; }).join("")}
                <li><span class="pill">Sat</span><span class="small">${esc(w.challenge)}</span></li>
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
    <section class="hero"><h1>Weekly challenges</h1><p>${doneCount} of ${weeks.length} done. Link what you built so this page becomes your portfolio.</p></section>
    <div class="card"><ul class="list">
      ${upto.slice().reverse().map((w) => {
        const c = state.challenges[w.id] || {};
        return `<li class="challenge">
          <div>
            <div class="eyebrow">Week ${w.n} · ${esc(w.title)} ${w === cur ? '<span class="pill accent">This week</span>' : ""}</div>
            <div>${esc(w.challenge)}</div>
            <input type="url" placeholder="Link to your write-up, repo or demo" value="${esc(c.link || "")}" data-challenge-link="${w.id}" style="margin-top:.5rem">
          </div>
          <select data-challenge-status="${w.id}">${statuses.map((s) => `<option ${(c.status || "Not started") === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </li>`;
      }).join("")}
    </ul></div>
    <p class="muted small">Future challenges unlock as you reach their week. You can see them all on the <a href="#roadmap">roadmap</a>.</p>`;
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
    <section class="hero"><h1>Log</h1><p>${entries.length} check-ins, ${hours().toFixed(1)} hours, current streak ${streak()} day${streak() === 1 ? "" : "s"}.</p></section>
    <div class="card" style="margin-bottom:1rem"><div class="heatmap">${cells.join("")}</div></div>
    <div class="card">
      ${entries.length ? `<ul class="list">${entries.map(([d, c]) => `
        <li><div class="row"><strong>${fmtDate(d, { weekday: "short", month: "short", day: "numeric" })}</strong><span class="muted small">${c.minutes || 60} min</span><span class="spacer"></span><button class="link small" data-uncheck="${d}">Remove</button></div>
        ${c.note ? `<div>${esc(c.note)}</div>` : '<div class="muted small">No note</div>'}</li>`).join("")}</ul>`
      : '<p class="muted">No check-ins yet. Do your first hour and check in on the <a href="#today">Today</a> page.</p>'}
    </div>`;
}

let readFilter = "all";
function viewReads() {
  const all = [...reads];
  const t = todaysRead();
  if (t && !all.some((r) => r.url === t.url)) all.unshift(t);
  const shown = all.filter((r) => readFilter === "all" || r.tag === readFilter);
  const doneCount = all.filter((r) => state.readsDone[r.url]).length;
  return `
    <section class="hero"><h1>Daily reads</h1><p>One hand-picked article a day. ${doneCount} of ${all.length} read.</p></section>
    <div class="tabs">${["all", "ai", "system-design", "fde"].map((f) => `<button data-filter="${f}" class="${readFilter === f ? "active" : ""}">${f === "all" ? "All" : labelTag(f)}</button>`).join("")}</div>
    <div class="card"><ul class="list">
      ${shown.map((r) => `<li>
        <div class="row small muted"><span>${fmtDate(r.date)}</span><span class="pill ${esc(r.tag)}">${labelTag(r.tag)}</span><span>${esc(r.source)}</span></div>
        <a class="read-title" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        ${r.why ? `<div class="small">${esc(r.why)}</div>` : ""}
        <label class="row small" style="margin-top:.35rem"><input type="checkbox" data-read="${esc(r.url)}" ${state.readsDone[r.url] ? "checked" : ""}> Read it</label>
      </li>`).join("") || '<li class="muted">Nothing here yet.</li>'}
    </ul></div>
    <p class="muted small">Want to read ahead? The <a href="#reads" data-show-seeds>reading list of classics</a> is below.</p>
    <details class="card"><summary><strong>Classics reading list (${seeds.length})</strong></summary><ul class="list" style="margin-top:.5rem">
      ${seeds.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="muted small">· ${esc(s.source)}</span> <label class="small"><input type="checkbox" data-read="${esc(s.url)}" ${state.readsDone[s.url] ? "checked" : ""}> read</label></li>`).join("")}
    </ul></details>`;
}

let changelogTab = "code";
function viewChangelog() {
  const code = changelog.claudeCode || [];
  const platform = changelog.platform || [];
  return `
    <section class="hero"><h1>Claude changelog</h1><p>Refreshed daily from the official sources${changelog.updated ? `, last on ${fmtDate(changelog.updated)}` : ""}.</p></section>
    <div class="tabs">
      <button data-cltab="code" class="${changelogTab === "code" ? "active" : ""}">Claude Code</button>
      <button data-cltab="platform" class="${changelogTab === "platform" ? "active" : ""}">Claude Platform and API</button>
    </div>
    <div class="card"><ul class="list">
      ${changelogTab === "code"
        ? code.map((v) => `<li><div class="row"><h3 style="margin:0">v${esc(v.version)}</h3><span class="muted small">seen ${fmtDate(v.firstSeen)}</span></div><ul class="changes small">${v.items.map((i) => `<li>${md(i)}</li>`).join("")}</ul></li>`).join("")
        : platform.map((d) => `<li><h3 style="margin:0">${fmtDate(d.date, { month: "long", day: "numeric", year: "numeric" })}</h3><ul class="changes small">${d.items.map((i) => `<li>${md(i)}</li>`).join("")}</ul></li>`).join("")}
    </ul></div>
    <p class="muted small">Sources: <a href="https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Claude Code CHANGELOG.md</a> · <a href="https://platform.claude.com/docs/en/release-notes/overview" target="_blank" rel="noopener">Claude Platform release notes</a></p>`;
}

// ---------- routing and events ----------

const ROUTES = { today: viewToday, roadmap: viewRoadmap, challenges: viewChallenges, log: viewLog, reads: viewReads, changelog: viewChangelog };

function render() {
  const route = location.hash.slice(1) || "today";
  const view = ROUTES[route] || viewToday;
  $("#app").innerHTML = view();
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${route}`));
  if (route === "roadmap") document.querySelector(".week.current")?.scrollIntoView({ block: "center" });
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

window.addEventListener("hashchange", render);

loadData().then(render).catch((err) => {
  $("#app").innerHTML = `<p>Couldn't load the site data. If you opened index.html directly, serve the folder instead (for example <code>npx serve .</code>).</p><p class="muted small">${esc(err.message)}</p>`;
});
