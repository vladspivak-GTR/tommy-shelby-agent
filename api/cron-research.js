// Vercel Serverless Function — runs Tommy's daily reconnaissance and commits
// data/discoveries.json back to GitHub. The commit triggers a Vercel redeploy
// which makes the new findings visible on the dashboard.

const path = require('path');
const fs = require('fs');
const { runTommy } = require('../scripts/tommy.js');

const GITHUB_OWNER = 'vladspivak-GTR';
const GITHUB_REPO = 'tommy-shelby-agent';
const DISCOVERIES_PATH = 'data/discoveries.json';

async function commitToGitHub(content, message, ghToken) {
  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
  const headers = {
    Authorization: `Bearer ${ghToken}`,
    'User-Agent': 'tommy-shelby-cron',
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
  };

  // Get current SHA of the file (if exists)
  const getRes = await fetch(`${apiBase}/contents/${DISCOVERIES_PATH}`, { headers });
  let sha;
  if (getRes.ok) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub GET failed: ${getRes.status} ${await getRes.text()}`);
  }

  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: 'main',
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(`${apiBase}/contents/${DISCOVERIES_PATH}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!putRes.ok) throw new Error(`GitHub PUT failed: ${putRes.status} ${await putRes.text()}`);
  return putRes.json();
}

async function fetchAssetsFromGitHub(ghToken) {
  // Read assets.json from the deployed repo so we always have the latest list
  // even if the worktree on the serverless instance is missing the file.
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/data/assets.json`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'tommy-shelby-cron' },
  });
  if (!res.ok) throw new Error(`Could not fetch assets.json: ${res.status}`);
  const json = await res.json();
  return JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
}

async function fetchDiscoveriesFromGitHub(ghToken) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DISCOVERIES_PATH}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'tommy-shelby-cron' },
  });
  if (res.status === 404) return { history: [], total_discoveries: 0 };
  if (!res.ok) throw new Error(`Could not fetch discoveries.json: ${res.status}`);
  const json = await res.json();
  return JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
}

module.exports = async function handler(req, res) {
  // Auth: only Vercel Cron OR a request bearing CRON_SECRET
  const isCron = req.headers['x-vercel-cron'] === '1';
  const auth = req.headers.authorization || '';
  const ok = isCron || (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { ANTHROPIC_API_KEY, GITHUB_TOKEN } = process.env;
    if (!ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
    if (!GITHUB_TOKEN) throw new Error('Missing GITHUB_TOKEN');

    const [assets, prevDiscoveries] = await Promise.all([
      fetchAssetsFromGitHub(GITHUB_TOKEN),
      fetchDiscoveriesFromGitHub(GITHUB_TOKEN),
    ]);

    const { discoveries, report } = await runTommy({
      apiKey: ANTHROPIC_API_KEY,
      assets,
      discoveries: prevDiscoveries,
    });

    const newCount = report.affiliate_networks.length + report.traffic_sources.length;
    const message = `Tommy daily recon ${report.date} (+${newCount} new) [skip ci]`;
    const commit = await commitToGitHub(JSON.stringify(discoveries, null, 2), message, GITHUB_TOKEN);

    res.status(200).json({
      ok: true,
      date: report.date,
      new_networks: report.affiliate_networks.length,
      new_traffic_sources: report.traffic_sources.length,
      summary: report.summary,
      searches_run: report.searches_run,
      rejected_as_duplicates:
        (report.rejected_as_duplicates.networks.length || 0) +
        (report.rejected_as_duplicates.traffic_sources.length || 0),
      commit_sha: commit && commit.commit && commit.commit.sha,
    });
  } catch (err) {
    console.error('[tommy-cron] FATAL:', err);
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
};
