// ===========================================================================
// Tommy Shelby — Daily Intelligence Agent
//
// Searches Google, forums, and the open web for NEW affiliate networks and
// traffic sources that we don't already work with, then writes findings to
// data/discoveries.json (kept as a rolling history, newest first).
//
// Usage (local):  ANTHROPIC_API_KEY=sk-ant-... node scripts/tommy.js
// Usage (Vercel): invoked from api/cron-research.js
// ===========================================================================

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ASSETS_PATH = path.join(REPO_ROOT, 'data', 'assets.json');
const DISCOVERIES_PATH = path.join(REPO_ROOT, 'data', 'discoveries.json');

const ANTHROPIC_MODEL = 'claude-opus-4-7';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const HISTORY_LIMIT = 60; // keep last ~2 months of daily reports

// ---------------------------------------------------------------------------
// Asset normalization — for de-duplication. Lowercase, strip non-alphanum.
// ---------------------------------------------------------------------------
function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildKnownSets(assets) {
  const knownNetworks = new Set();
  const knownTrafficSources = new Set();
  for (const company of Object.keys(assets.affiliate_networks || {})) {
    for (const n of assets.affiliate_networks[company]) {
      // Some entries have combined names like "Admitad + takedeals + convertsocial"
      for (const part of String(n.name).split(/[+&,/]|\sand\s/i)) {
        const norm = normalizeName(part);
        if (norm.length >= 2) knownNetworks.add(norm);
      }
    }
  }
  for (const t of assets.traffic_sources || []) {
    knownTrafficSources.add(normalizeName(t.name));
  }
  // Also exclude TS we've previously discovered (so we don't surface them daily)
  return { knownNetworks, knownTrafficSources };
}

function extendKnownWithDiscoveries(known, discoveries) {
  for (const report of discoveries.history || []) {
    for (const f of report.affiliate_networks || []) {
      known.knownNetworks.add(normalizeName(f.name));
    }
    for (const f of report.traffic_sources || []) {
      known.knownTrafficSources.add(normalizeName(f.name));
    }
  }
}

// ---------------------------------------------------------------------------
// Claude API call with web_search tool. Returns the structured JSON Tommy
// produced after researching.
// ---------------------------------------------------------------------------
async function runClaudeAgent(apiKey, knownNetworks, knownTrafficSources) {
  const knownNetworksList = Array.from(knownNetworks).slice(0, 250).join(', ');
  const knownTSList = Array.from(knownTrafficSources).join(', ');
  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `You are Tommy Shelby, a sharp-eyed intelligence agent for a media-buying operation. Your only job is to find NEW affiliate networks and NEW ad/traffic sources that this operation does not already work with — by searching Google, marketing forums (affiliatefix, afflift, stackthatmoney, blackhatworld, warrior forum, indoleads forum, etc.), industry blogs, conference speaker lists, and the open web.

You work in the affiliate marketing & media buying world. The operation already uses many networks for cashback / rewards / coupons / loyalty / shopping verticals, and runs paid traffic via popunder, push, native, in-page push, and pop-up ad networks. Focus your research on these verticals.

You speak plainly. No fluff. No emojis. Get to the point.

You MUST respond with a single JSON object (no markdown fences) shaped exactly like this:
{
  "summary": "1-2 sentence summary of today's reconnaissance — what you searched, what looked interesting",
  "affiliate_networks": [
    {
      "name": "ExampleNetwork",
      "website": "https://example.com",
      "description": "1-2 sentence what they do — verticals, geos, size",
      "type": "CPA | Cashback | Rewards | Loyalty | Shopping | Coupon | etc.",
      "geo": "Global | US | EU | Asia | etc. (optional)",
      "commission_model": "RevShare | CPA | Hybrid | CPS (optional)",
      "source": "where you found it (e.g. 'AffLIFT thread', 'Google search', 'industry blog')"
    }
  ],
  "traffic_sources": [
    {
      "name": "ExampleTS",
      "website": "https://example.com",
      "description": "1-2 sentence what type of traffic — popunder/push/native/etc.",
      "type": "Popunder | Push | Native | Pop | In-page push | Display | etc.",
      "geo": "Global | Tier 1 | Tier 3 | etc. (optional)",
      "source": "where you found it"
    }
  ]
}

CRITICAL RULES:
1. NEVER include any network or traffic source from the EXCLUDE LIST below. Even close variants (e.g. if "MGID" is excluded, do not list "MGID Native"). Cross-check normalized names (lowercase, no spaces/hyphens).
2. Only include items you actually found via web search. If your search returns nothing genuinely new, return empty arrays.
3. Quality over quantity. 3-8 strong candidates per category beats 20 weak ones.
4. Prefer real, currently-operating networks/TS. Avoid scams, dead products, and obvious aggregators of aggregators.
5. The website URL must be the actual landing page (no Google redirect URLs, no tracking links).
6. Every item must have a name and at least one of: description or website.

EXCLUDE LIST — affiliate networks already in our portfolio (do not suggest these or their close variants):
${knownNetworksList}

EXCLUDE LIST — traffic sources we already use:
${knownTSList}`;

  const userPrompt = `Today is ${today}. Run your daily reconnaissance:

1. Search Google for new affiliate networks in cashback / rewards / coupons / loyalty / shopping verticals that we don't have yet.
2. Search Google + affiliate forums (affiliatefix.com, afflift.com, stmforum.com, etc.) for ad networks / traffic sources that media buyers are talking about right now (popunder, push, native, in-page).
3. Cross-check every candidate against the EXCLUDE LISTS in your instructions before including it.
4. Return only the JSON object — no preamble, no markdown.

Spend 6-12 web searches total. Be thorough but efficient.`;

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 12,
      },
    ],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();

  // Find the last text block — that's where Tommy's JSON answer lives.
  let textOut = '';
  for (const block of data.content || []) {
    if (block.type === 'text') textOut = block.text;
  }
  if (!textOut) throw new Error('No text response from Claude. Got: ' + JSON.stringify(data).slice(0, 500));

  // Strip code fences if Claude wrapped them anyway.
  textOut = textOut.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch (e) {
    // If JSON parse fails, try to extract the first {...} block.
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse JSON from Claude response. Raw: ' + textOut.slice(0, 800));
    parsed = JSON.parse(m[0]);
  }

  // Tally web search usage from server tool use blocks (best-effort)
  const searchCalls = (data.content || []).filter(b => b.type === 'server_tool_use' && b.name === 'web_search').length;

  return { ...parsed, searches_run: searchCalls, model: ANTHROPIC_MODEL };
}

// ---------------------------------------------------------------------------
// Filter Tommy's findings against our known lists (defense in depth — the
// model might still suggest something on the exclude list).
// ---------------------------------------------------------------------------
function filterDuplicates(findings, knownNetworks, knownTrafficSources) {
  const filtered = {
    affiliate_networks: [],
    traffic_sources: [],
    rejected_networks: [],
    rejected_traffic_sources: [],
  };
  for (const item of findings.affiliate_networks || []) {
    if (!item.name) continue;
    const norm = normalizeName(item.name);
    if (knownNetworks.has(norm)) {
      filtered.rejected_networks.push(item.name);
      continue;
    }
    // Also check if any token in the name matches (e.g. "MGID Native" against "mgid")
    const tokens = item.name.toLowerCase().split(/[\s\-+&,/]+/).filter(t => t.length >= 3);
    if (tokens.some(t => knownNetworks.has(normalizeName(t)))) {
      filtered.rejected_networks.push(item.name);
      continue;
    }
    filtered.affiliate_networks.push(item);
  }
  for (const item of findings.traffic_sources || []) {
    if (!item.name) continue;
    const norm = normalizeName(item.name);
    if (knownTrafficSources.has(norm)) {
      filtered.rejected_traffic_sources.push(item.name);
      continue;
    }
    const tokens = item.name.toLowerCase().split(/[\s\-+&,/]+/).filter(t => t.length >= 3);
    if (tokens.some(t => knownTrafficSources.has(normalizeName(t)))) {
      filtered.rejected_traffic_sources.push(item.name);
      continue;
    }
    filtered.traffic_sources.push(item);
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Public entry point — also used by the Vercel serverless function.
// ---------------------------------------------------------------------------
async function runTommy(opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const assets = opts.assets || JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));
  const discoveries = opts.discoveries || (fs.existsSync(DISCOVERIES_PATH)
    ? JSON.parse(fs.readFileSync(DISCOVERIES_PATH, 'utf8'))
    : { history: [], total_discoveries: 0 });

  const known = buildKnownSets(assets);
  extendKnownWithDiscoveries(known, discoveries);

  console.log(`[tommy] Known networks: ${known.knownNetworks.size}, known TS: ${known.knownTrafficSources.size}`);
  console.log(`[tommy] Calling Claude (${ANTHROPIC_MODEL}) with web_search...`);

  const raw = await runClaudeAgent(apiKey, known.knownNetworks, known.knownTrafficSources);
  console.log(`[tommy] Claude returned ${(raw.affiliate_networks || []).length} networks, ${(raw.traffic_sources || []).length} traffic sources, after ${raw.searches_run || 0} web searches`);

  const filtered = filterDuplicates(raw, known.knownNetworks, known.knownTrafficSources);
  console.log(`[tommy] After dedupe: ${filtered.affiliate_networks.length} networks, ${filtered.traffic_sources.length} TS (rejected ${filtered.rejected_networks.length + filtered.rejected_traffic_sources.length})`);

  const today = new Date().toISOString().split('T')[0];
  const report = {
    date: today,
    generated_at: new Date().toISOString(),
    summary: raw.summary || '',
    searches_run: raw.searches_run || 0,
    model: raw.model,
    affiliate_networks: filtered.affiliate_networks,
    traffic_sources: filtered.traffic_sources,
    rejected_as_duplicates: {
      networks: filtered.rejected_networks,
      traffic_sources: filtered.rejected_traffic_sources,
    },
  };

  // Merge into history. If we already have a report from today, replace it.
  const history = (discoveries.history || []).filter(h => h.date !== today);
  history.unshift(report);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;

  const totalDiscoveries = history.reduce(
    (sum, r) => sum + (r.affiliate_networks || []).length + (r.traffic_sources || []).length,
    0
  );

  const out = {
    generated_at: new Date().toISOString(),
    last_run: new Date().toISOString(),
    next_run: computeNextRun(),
    total_discoveries: totalDiscoveries,
    history,
  };

  return { discoveries: out, report };
}

function computeNextRun() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 6, 0, 0));
  return next.toISOString();
}

// ---------------------------------------------------------------------------
// CLI mode — write to disk.
// ---------------------------------------------------------------------------
async function main() {
  const { discoveries, report } = await runTommy();
  fs.writeFileSync(DISCOVERIES_PATH, JSON.stringify(discoveries, null, 2));
  console.log(`\n[tommy] Wrote ${DISCOVERIES_PATH}`);
  console.log(`[tommy] Today's report (${report.date}):`);
  console.log(`        ${report.affiliate_networks.length} new networks, ${report.traffic_sources.length} new traffic sources`);
  if (report.summary) console.log(`        Summary: ${report.summary}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[tommy] FATAL:', err);
    process.exit(1);
  });
}

module.exports = { runTommy, normalizeName, buildKnownSets };
