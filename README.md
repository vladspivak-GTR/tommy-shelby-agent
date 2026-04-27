# Tommy Shelby — Daily Intelligence Agent

Single-page dashboard + autonomous daily research agent. Tommy searches Google,
forums, and the open web every day for **new affiliate networks** and **new
traffic sources** that we don't already work with, then writes findings to
[`data/discoveries.json`](data/discoveries.json) and the dashboard surfaces
them.

## Architecture

```
┌─────────────────────┐    daily 06:00 UTC     ┌───────────────────────┐
│ Vercel Cron         │ ─────────────────────► │ /api/cron-research    │
└─────────────────────┘                        └───────────┬───────────┘
                                                           │
                                                           ▼
                              ┌────────────────────────────────────────┐
                              │ scripts/tommy.js                       │
                              │  • read data/assets.json (known)       │
                              │  • read data/discoveries.json (history)│
                              │  • build EXCLUDE list                  │
                              │  • call Claude API + web_search tool   │
                              │  • dedupe response                     │
                              │  • return updated discoveries.json     │
                              └───────────────────┬────────────────────┘
                                                  │
                                                  ▼
                              ┌────────────────────────────────────────┐
                              │ commit data/discoveries.json to GitHub │
                              │   → triggers Vercel redeploy           │
                              │   → dashboard reads JSON client-side   │
                              └────────────────────────────────────────┘
```

## Files

- `index.html` — single-page dashboard (Cinzel + Inter, dark Peaky-Blinders theme)
- `data/assets.json` — what we already have (per company AN + global TS)
- `data/discoveries.json` — rolling history of Tommy's daily findings
- `scripts/tommy.js` — agent logic (callable from CLI or serverless)
- `api/cron-research.js` — Vercel cron handler
- `vercel.json` — cron schedule (`0 6 * * *`)

## Env vars (production)

| Name | Purpose |
|------|---------|
| `ANTHROPIC_API_KEY` | Claude API key for Tommy's brain + `web_search_20250305` tool |
| `GITHUB_TOKEN` | PAT with `repo` scope — used to commit `discoveries.json` |
| `CRON_SECRET` | Bearer token for manual `/api/cron-research` triggers |

## Manual trigger

```bash
CRON_SECRET=<value> curl -X POST https://tommy-shelby-agent.vercel.app/api/cron-research \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Local run

```bash
ANTHROPIC_API_KEY=sk-ant-... node scripts/tommy.js
```

Writes the report straight to `data/discoveries.json`.
