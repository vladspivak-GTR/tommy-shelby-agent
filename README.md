# Tommy Shelby — Daily Intelligence Agent

Storage repository for Tommy Shelby, a Claude Code Scheduled Agent that runs
every Monday at 10:00 Israel time and searches the web for new affiliate
networks and traffic sources.

This repository now holds **only the data files** Tommy reads and writes:

- `data/assets.json` — known affiliate networks (per company) + traffic
  sources we already use. Tommy uses this as the EXCLUDE list.
- `data/discoveries.json` — rolling history of Tommy's weekly findings.

The routine itself lives at
`C:\Users\Vlad\.claude\scheduled-tasks\tommy-shelby-daily-recon\SKILL.md`
on the operator's machine.

Tommy delivers reports directly to the Slack channel
`#tommy-shelby-af-ts-discoveries` — there is no web dashboard.
