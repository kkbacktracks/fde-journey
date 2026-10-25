# FDE Journey

A personal site for one hour a day, every day, toward becoming a forward deployed engineer by April 2027.

- **Today**: this week's topic, today's task, a daily check-in, streak, and today's read
- **Roadmap**: 26 weeks in four phases with tickable tasks
- **Challenges**: one Saturday challenge per week, with status and a link to what you built
- **Log**: a heatmap of check-ins and your daily notes
- **Reads**: one curated AI or system design article a day, one Substack post of the day, plus a classics list
- **Claude changelog**: Claude Code and Claude Platform release notes, refreshed daily

## How it works

Plain HTML, CSS and JavaScript. No build step. Content lives in `data/`:

| File | What it holds | Who edits it |
| --- | --- | --- |
| `roadmap.json` | Phases, weeks, tasks, challenges, start date | You |
| `seed-reads.json` | Evergreen classics used on quiet days | You |
| `feeds.json` | RSS feeds the daily pick draws from | You |
| `substacks.json` | Substack newsletters the Substack pick draws from | You |
| `reads.json` | One pick per day, newest first | The daily job |
| `substack-reads.json` | One Substack pick per day, newest first | The daily job |
| `changelog.json` | Latest Claude Code and Platform release notes | The daily job |

Progress (check-ins, ticks, challenge links) is stored in your browser. Use **Export backup** in the footer now and then, and **Import backup** on a new device.

## Daily job

`.github/workflows/daily-content.yml` runs `scripts/update-content.mjs` at 06:00 Pacific (07:00 during daylight saving). It:

1. Pulls the feeds in `feeds.json`, keeps posts from the last 3 weeks you haven't seen, and ranks them by source weight, recency, topic keywords and fit with your current roadmap phase.
2. If the `ANTHROPIC_API_KEY` secret is set, asks Claude (Opus 5.5, low effort) to choose the best of the top 15 and write a two-line "why read this". Otherwise it takes the top-ranked post.
3. On a quiet day, falls back to the next unread classic from `seed-reads.json`.
4. Does the same for `substacks.json` (posts from the last 30 days; teaser-only posts, usually paywalled, are skipped) and writes `substack-reads.json`.
5. Refreshes `changelog.json` from the Claude Code CHANGELOG and the Claude Platform release notes.
6. Commits and triggers a deploy.

Change the time zone with a repository variable `SITE_TZ` (default `America/Los_Angeles`).

## Setup

1. Push this folder to a GitHub repo.
2. Settings → Pages → Source: **GitHub Actions**.
3. Optional: Settings → Secrets and variables → Actions → add `ANTHROPIC_API_KEY`.
4. Actions → Daily content → **Run workflow** once to fill today's content.

## Run locally

```sh
npm install
npm run update   # optional: refresh data/
npm run serve    # then open the printed URL
```
