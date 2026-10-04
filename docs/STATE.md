# Guess the Game — Current State (as of 2026-10-04)

## Can I test it right now?

Yes. Dev servers run on **http://localhost:5173/** and **http://localhost:5174/**
(both watch the same files — if behavior looks stale, hard-refresh with
Ctrl+F5). Play: guess → reveal → hint → round → summary → share links.
`npm run test` (25 vitest cases) and `npm run build` pass;
`node scripts/audit.mjs` is the data health check.

## What works

- **Core loop**: pixelated screenshot (4×4 → full), fuzzy guessing with
  typo/alias/regional-title tolerance, ambiguity prompts ("🔎 Almost — …,
  which one?"), close-guess feedback, title-shape hint (−150), auto-reveal
  every 2nd wrong guess, decreasing points, no-repeat sessions.
- **Rounds**: 10 games from the filtered pool, summary with per-game scores,
  single-game share links, copyable round result.
- **Discord**: link sharing (`?game=`), paste-ready result/round messages,
  OG tags for unfurls (needs public https host — see OPERATIONS §6).
- **Filters**: genre (incl. RPG/Shooter groups), publisher, developer,
  platform, franchise, years + decades, mainstream-only default with
  *fan picks* toggle, 17 📦 package presets (Star Wars, N64, Sierra,
  Made in Germany, engines…).
- **Result card**: genre/publisher/developer/platforms, Metacritic (where
  known, ~600 scores via RAWG), Amazon + MobyGames links (affiliate-ready,
  tag empty), footer Sources & credits (IGDB, libretro; RAWG row still open).
- **Pool**: ~1,500 levels (202 hand-curated TSV + ~1,300 bulk + custom),
  1976–2026, 80+ platforms, screenshots in year folders with up to 3 shots
  per level (rotation + fallback chain when files are deleted). Health:
  0 orphans, 0 byte-dupes, ~600 Metacritic scores, regional aliases, 25/25 tests.
- **Tooling**: IGDB fetch (year-aware matcher), bulk import (year/company/
  platform/franchise/engine/enrich), Libretro retro fallback, add-custom,
  audit (missing/orphans/dupes/exotics), remove (single + bulk), backfills
  (popular/franchise/engine, metacritic, aliases), TSV build with validation.

## What's NOT done / known gaps

- **Screenshot content review**: ~1,300 images unreviewed by a human (covers,
  wrong games, DLC shots). Fallout shows FO2, Minecraft entry is 2016-dated,
  Arkham Knight skin matched once — review via `audit --year XXXX`.
- **3 shot-less levels**: Leisure Suit Larry, Assassin's Creed 1, Journey
  (no IGDB shots and no Libretro coverage — manual sourcing only).
- **Crysis 1** missing (no clean Crytek Frankfurt entity in IGDB).
- **~20 unreleased-2026 placeholders** kept deliberately — verify on release.
- **RAWG credits row** in footer not yet added (do with any RAWG display change).
- **No leaderboards**: score is per-browser + shared via Discord paste only.
- **No deploy yet**: `dist/` builds, but nothing is hosted publicly.

## Data safety notes

- No git repo — no version control. A backup of `games.auto.ts` lives in the
  temp folder from the exotic cleanup; screenshots are gitignored local-only.
- Bulk scripts are idempotent (skip existing, dedup) except `remove`, which
  permanently deletes entries + files.
