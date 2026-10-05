# Guess the Game — Current State (as of 2026-10-04)

## Can I test it right now?

Yes. Dev servers run on **http://localhost:5173/** and **http://localhost:5174/**
(both watch the same files — if behavior looks stale, hard-refresh with
Ctrl+F5). Play: guess → reveal → hint → round → summary → share links.
`npm run test` (39 vitest cases) and `npm run build` pass;
`node scripts/audit.mjs` is the data health check.

## What works

- **Core loop**: pixelated screenshot (16 wide to full), fuzzy guessing with
  typo/alias/regional-title tolerance, ambiguity prompts, close-guess
  feedback, wrong-game redirects ("That is Risen - same developer!"),
  developer/publisher nudges, two-step hints (year, then title shape,
  each halving points), auto-reveal every 2nd wrong guess, full-res on
  solve/give-up, no-repeat sessions. Setup screen holds packages+filters;
  play shows only the game. Full searchable game list as spelling aid.
- **Rounds**: 10 games from the filtered pool, summary with per-game scores,
  single-game share links, copyable round result.
- **Sharing**: level links (`?game=` short hash, no title spoiler),
  paste-ready result/round messages as text, mid-game challenge text
  (level + worth, never the title), spoiler-free shared-challenge banner,
  OG tags for unfurls (needs public https host — see OPERATIONS §6).
- **Filters**: multi-select facets (genre incl. RPG/Shooter groups, publisher,
  developer, platform, franchise), years + decades, mainstream-only default
  with *fan picks* toggle, 17 package presets (Star Wars, N64, Sierra,
  Made in Germany, engines…).
- **Result card**: genre/publisher/developer/platforms, Metacritic (where
  known, ~600 scores via RAWG), Amazon + MobyGames links (affiliate-ready,
  tag empty), footer Sources & credits (IGDB, libretro; RAWG row still open).
- **Pool**: ~1,510 levels (202 hand-curated TSV + ~1,310 bulk + custom),
  1976–2026, 80+ platforms. Every entry hotlinks IGDB CDN shots
  (100% remote coverage, hand remotes live in the TSV); local files are
  fallback-only, paths are deploy-base-relative. Health:
  0 orphans, 0 byte-dupes, ~600 Metacritic scores, regional aliases, 31/31 tests.
- **Tooling**: IGDB fetch (year-aware matcher), bulk import (year/company/
  platform/franchise/engine/enrich), Libretro retro fallback, add-custom,
  audit (missing/orphans/dupes/exotics), remove (single + bulk), backfills
  (popular/franchise/engine, metacritic, aliases), TSV build with validation.

## What's NOT done / known gaps

- **Screenshot content review**: ~1,300 images unreviewed by a human (covers,
  wrong games, DLC shots). Fixed this round: Duke3D Game.com photos, Doom
  1993 showing 2016 shots, Doom II listed twice. Minecraft entry is
  2016-dated, Arkham Knight skin matched once — review via `audit --year XXXX`.
  (Fallout now shows FO1 CDN shots; Larry/AC1/Journey play via CDN remotes.)
- **Deck13/Crytek batches added**: Ankh 1, Jack Keane 2, Blood Knights,
  Black Sails: The Ghost Ship, Haunted, Moorhuhn: Tiger and Chicken,
  Crysis 1-3, Ryse, KCD 1, Robinson, Hunt: Showdown, The Climb,
  Sniper: Ghost Warrior 2 (all default-visible). "Tiger & Chicken" turned
  out to be Moorhuhn: Tiger and Chicken (IGDB, Deck13 co-dev).
- **Crysis 1** missing (no clean Crytek Frankfurt entity in IGDB).
- **~20 unreleased-2026 placeholders** kept deliberately — verify on release.
- **RAWG credits row** in footer not yet added (do with any RAWG display change).
- **No leaderboards**: score is per-browser + shared via text paste only.
- **No deploy yet**: `dist/` builds, but nothing is hosted publicly.

## Data safety notes

- Local repo initialized (2 commits, no remote yet). A backup of `games.auto.ts` lives in the
  temp folder from the exotic cleanup; screenshots are gitignored local-only
  (fallback — the game runs fully off CDN remotes without them).
- Bulk scripts are idempotent (skip existing, dedup) except `remove`, which
  permanently deletes entries + files.
