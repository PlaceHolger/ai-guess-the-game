# Guess the Game — Future Ideas (parking lot, roughly by value/effort)

## Gameplay
- **Local round history + personal bests** (localStorage): date, filters,
  score, solved/total. Solo progression without any server.
- **Shared leaderboard** (only if wanted): Supabase/Upstash + anonymous
  names. Self-reported scores, no anti-cheat — fine for friends, meaningless
  globally. Alternative: the Discord channel already *is* the leaderboard.
- **Video rounds**: guess from gameplay clips (YouTube embeds per title).
  RAWG lists videos but gates them behind Business ($149/mo) — manual
  YouTube links per level are the free path.
- **Audio rounds**: guess from music/SFX (same manual-curation pattern).
- **Daily challenge**: one shared level per day (seed by date), streaks.
- **Difficulty tiers**: 4×4 start for all vs. higher-start "easy mode".
- **Timed rounds**: countdown per guess, bonus for speed.

## Data & sources
- **Wikipedia best-sellers flag**: explicit "best sellers" package. Decided
  against for now (IGDB votes + Metacritic cover 95% of "popular").
- **RAWG extras**: descriptions (result-card blurb), ESRB (kid-friendly
  filter), playtime stat, mood tags as categories. Needs RAWG key (have it)
  + attribution row (footer ready).
- **Wikidata aliases**: non-IGDB regional titles. Only if IGDB gaps hurt.
- **Top 20 per platform** (Nintendo / Sony / Microsoft / Sega / C64):
  per-platform IGDB top-by-rating cross-check against the pool, import the
  gaps like the DOS batch (dry, dedupe editions, fetch, backfill, verify).
- **SteamGridDB artwork**: alternative art source. Uneven quality, skip unless
  a gap demands it.

## Discord & social
- **Discord Activity** (Embedded App SDK): play *inside* Discord instead of
  link-out. Real project (app setup, tunnel, iframe) — only if link sharing
  proves too frictionful.
- **Results bot**: bot collects pasted scores into channel leaderboard.
  Middle ground between manual paste and full backend.

## Monetization (commercial implications!)
- Amazon affiliate tag (`AFFILIATE_TAG` in `lib/game.ts`, disclosure UI
  ready). Note: RAWG free tier is non-commercial — flipping on ads means
  re-checking RAWG terms (likely Business plan) or dropping MC scores.
- Donation link / Patreon before ads.

## Tech hygiene
- Init a git repo (data safety — currently none).
- Chunk `games.hand.ts` too if the hand list ever grows past ~300 rows
  (same TS2590 limit that forced `games.auto.ts` chunking).
- `tsv-from-ts.mjs` is one-way; hand edits now flow TSV → TS only.
- Prune `scripts/` temp-file discipline: all project scripts `--check` clean;
  keep it that way (a German-batch outage came from an untested edit).
