#!/usr/bin/env node
// Fetches the 2026 NHL first-round playoff bracket and per-player regular-season
// stats for each of the 16 teams, then writes data/players.json.
//
// Usage: node scripts/fetch-data.js [year]
//   year defaults to 2026

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const YEAR = Number(process.argv[2] ?? 2026);
const API = 'https://api-web.nhle.com/v1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'data', 'players.json');

async function getJson(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function divisionForLetter(letter) {
  // Bracket letters A/B are in one conference, C/D in the other — we group by
  // series letter only (no conference label needed for the UI). Fall back to
  // the letter itself so the label is always deterministic.
  return `Series ${letter}`;
}

async function fetchTeamPlayers(abbrev) {
  const data = await getJson(`${API}/club-stats/${abbrev}/now`);
  const players = [];
  for (const s of data.skaters ?? []) {
    players.push({
      id: s.playerId,
      name: `${s.firstName?.default ?? ''} ${s.lastName?.default ?? ''}`.trim(),
      pos: s.positionCode,
      gp: s.gamesPlayed ?? 0,
      g: s.goals ?? 0,
      a: s.assists ?? 0,
      pts: s.points ?? 0,
    });
  }
  for (const g of data.goalies ?? []) {
    players.push({
      id: g.playerId,
      name: `${g.firstName?.default ?? ''} ${g.lastName?.default ?? ''}`.trim(),
      pos: 'G',
      gp: g.gamesPlayed ?? 0,
      g: g.goals ?? 0,
      a: g.assists ?? 0,
      pts: g.points ?? 0,
    });
  }
  players.sort((x, y) => y.pts - x.pts || y.g - x.g || x.name.localeCompare(y.name));
  return players;
}

async function main() {
  console.log(`Fetching playoff bracket for ${YEAR}…`);
  const bracket = await getJson(`${API}/playoff-bracket/${YEAR}`);
  const firstRound = (bracket.series ?? []).filter((s) => s.playoffRound === 1);
  if (firstRound.length !== 8) {
    throw new Error(`Expected 8 first-round series, got ${firstRound.length}. ` +
      `Bracket may not be finalized yet.`);
  }

  const series = [];
  for (const s of firstRound) {
    const top = s.topSeedTeam;
    const bot = s.bottomSeedTeam;
    console.log(`  Series ${s.seriesLetter}: ${top.abbrev} vs ${bot.abbrev}`);
    const [topPlayers, botPlayers] = [
      await fetchTeamPlayers(top.abbrev),
      await fetchTeamPlayers(bot.abbrev),
    ];
    // Small courtesy delay between series to avoid hammering the API.
    await sleep(150);
    series.push({
      id: s.seriesLetter,
      label: divisionForLetter(s.seriesLetter),
      teams: [
        {
          abbrev: top.abbrev,
          name: top.name?.default ?? top.abbrev,
          seed: s.topSeedRankAbbrev,
          players: topPlayers,
        },
        {
          abbrev: bot.abbrev,
          name: bot.name?.default ?? bot.abbrev,
          seed: s.bottomSeedRankAbbrev,
          players: botPlayers,
        },
      ],
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    season: `${YEAR - 1}${YEAR}`,
    series,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const totalPlayers = series.reduce(
    (acc, s) => acc + s.teams.reduce((a, t) => a + t.players.length, 0),
    0,
  );
  console.log(`Wrote ${OUT_PATH} — ${series.length} series, ${totalPlayers} players.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
