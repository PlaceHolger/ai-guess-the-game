# Guess the Game — Current State (as of 2026-11-13)

## Can I test it right now?

Yes. `npm run dev` serves **http://localhost:5173/**; `npm run test` (88 vitest
cases, 7 files), `npm run build`, `npx tsc --noEmit` and `node scripts/audit.mjs`
are green (0 missing shots, 0 orphans, 0 dupes, 0 shared remotes).

Branch state: work lives on **`feature/persistence`**, 2 commits ahead of
`main` (`43b72d4`). GitHub Pages deploys on push to `main`, so the two newest
commits (round persistence, autocomplete) are **not live yet**.

## What works

- **Core loop**: pixelated screenshot (16 wide to full), fuzzy guessing with
  typo/alias/regional-title tolerance, ambiguity prompts, close-guess
  feedback, wrong-game redirects ("That is Risen - same developer!"),
  developer/publisher nudges, two-step hints (year, then title shape,
  each halving points), auto-reveal every 2nd wrong guess, full-res on
  solve/give-up, no-repeat sessions.
- **Autocomplete**: ranked suggestions from the whole pool (starts-with
  hits first, alphabetical), alias rows ("Anno 1404 → Dawn of Discovery
  (2009)") with the typed part underlined; picking fills the canonical
  "Title (year)", submit stays free-text (typos/regional names included).
- **Rounds**: 10 games from the filtered pool, summary with per-game scores,
  single-game share links, copyable round result.
- **Resume**: a running round and its per-level state (level, attempts,
  wrong guesses, hints, solved, shot) survive a reload via sessionStorage,
  with resume/discard on return. A single level with no round running is
  parked the same way while it is unsolved (same riddle, same screenshot,
  same pixelation); once solved or given up the snapshot is dropped so F5
  moves on. `?game=`/`?round=` links win over stored state. React error
  boundary catches crashes with a reload path.
- **History**: last 30 finished rounds + personal best in localStorage,
  shown on setup and summary.
- **Sharing**: level links (`?game=` short hash, no title spoiler), round
  links, paste-ready result/round/challenge text, spoiler-free shared
  banner, OG tags for unfurls (needs the public Pages URL).
- **Filters**: multi-select facets (genre incl. RPG/Shooter groups,
  publisher, developer, platform, franchise), years + decades,
  mainstream-only default with *fan picks* toggle, 17 package presets.
  Shared-link facets/years are validated (unknown values stripped, years
  clamped).
- **Result card**: genre/publisher/developer/platforms, Metacritic (where
  known, ~600 scores via RAWG), sales (`≈15M copies`, 143 published
  figures from Wikidata/Wikipedia) with source tooltip, Amazon + MobyGames
  links (affiliate-ready, tag empty), footer Sources & credits.
- **Pool**: 1,616 levels (202 hand-curated TSV + 1,414 bulk + custom),
  1976–2026, 80+ platforms. Entries hotlink IGDB CDN shots (`remote`/
  `remoteAlts`); local files are fallback-only and gitignored. Health:
  0 orphans, 0 byte-dupes, 0 shared shots, regional aliases, 88 tests.
  Latest refresh: 58 entries for 2024–2026 (Nov 2026).
- **Tooling**: IGDB fetch (year-aware matcher), bulk import (year/company/
  platform/franchise/engine/title/enrich), Libretro retro fallback,
  add-custom, audit (exit codes + `--strict`/`--shared-remote`/`--dupes`),
  remove (single + bulk, hardened with `--yes`), backfills (popular/
  franchise/engine, metacritic, aliases, remotes), sales fetch, fix-data/
  prune-aliases, TSV build (validates rows, compiles `sales.ts`), game
  list. CI runs test + audit + build and deploys `dist/` to Pages on main.

## What's NOT done / known gaps

- **Branch not merged/deployed**: `feature/persistence` is 2 commits ahead
  of `main`; Pages still serves `43b72d4`. Merge to ship.
- **Screenshot content review**: ~1,300 images still unreviewed by a human
  (covers, wrong games, DLC shots). `npm run audit` currently flags 27
  entries with the generic `Action` genre; review via `audit --year XXXX`,
  then `sync-shots` / `remove`.
- **2026 titles imported pre-release**: 20 entries dated 2026 were bulk
  imports of then-upcoming games. Verify each now that it is (or is not)
  out; `valheim` was corrected to its original 2021 release (IGDB's
  `first_release_date` had drifted to a later version).
- **Data refresh is manual**: no scheduled job; run the new-release
  routine in OPERATIONS §3f when a batch of releases is worth adding.
- **No leaderboards**: score is per-browser + shared via text paste only.
- **Ideas only** (docs/IDEAS.md): daily challenge, full keyboard play,
  DE/EN localization, wide desktop/fullscreen layout, replay earlier
  round levels.
- **Bundle**: single ~1.13 MB JS chunk; splitting is gated on the frozen
  `shotsFor()` order (share links index into it positionally).

## Data safety notes

- Remote exists (`github.com/PlaceHolger/ai-guess-the-game`). Branch work
  is pushed; `main` and `gh-pages` are the deployed pair.
- Generated files: `games.hand.ts` (from `games.tsv`), `sales.ts` (from
  `sales.tsv`), `docs/GAME-LIST.md` (from the pool). Edit the sources and
  run `npm run data:build` / `npm run list`; scripts revert direct edits.
- Screenshots are gitignored local fallbacks; the app runs off CDN
  remotes without them.
- Ids are frozen (share links + filenames). Screenshots for removed
  entries are deleted by `npm run remove` (use `--keep-shot` to keep).
- `.kilo/` holds another session's stale worktree (clean, no unique
  commits). Leave it alone.
