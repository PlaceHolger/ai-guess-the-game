# GameGuesser — guess popular games from pixelated screenshots

Start at **4×4 pixels** (1000 pts). Don't know it? Reveal **8×8 → 16×16 → 32×32 → 64×64 → 96×96 → full**
for 500 / 250 / 125 / 60 / 40 / 20 pts. Near answers count: `final fantasy` is accepted for
*Final Fantasy VII*, `gta 5` for *Grand Theft Auto V*, typos included.

**Rounds:** pick genre / publisher / developer / platform / franchise / year
filters (or a one-click 📦 package like Star Wars, N64, Sierra, Made in
Germany), hit **Start round** — you get 10 random levels from that pool, then
a summary with per-game scores. The default pool is **mainstream only**
(`popular` flag: hand list always, bulk entries by IGDB votes); tick
*fan picks* to include niche/homebrew titles. From the summary you can share
any single game (`?game=<id>` link) or copy the whole round result to Discord.

## Quick start

```sh
npm install
npm run dev
```

Playable immediately — without screenshots it shows generated placeholder art so you can
test the flow. Add real screenshots (below) for the actual game.

## Screenshots (one-time fetch, your manual review)

Bundling ~200 copyrighted screenshots in git would be a legal problem, so the repo ships
**titles + metadata only**. Fetch them once via the legal API route (IGDB, which serves
publisher-provided screenshots) and curate by hand:

```sh
cp .env.example .env   # fill IGDB_CLIENT_ID / IGDB_CLIENT_SECRET from dev.twitch.tv/console
npm run fetch:screenshots
# review public/screenshots/<year>/*.jpg — keep only real IN-GAME shots, no covers/logos
npm run dev
```

The script reads `src/data/games.ts` (`id` + `year` + `igdbQuery`), takes each game's top IGDB match,
downloads the widest screenshot as `public/screenshots/<year>/<id>.jpg`, and writes
`ATTRIBUTION.md`. Re-run with `npm run fetch:screenshots -- <id>` for a single game.
Existing files are skipped, so re-running after adding games only fetches the new ones.
IGDB images remain © their publishers; keep the attribution file and use them only in
this guessing context (fair-use-style, plus IGDB API terms).

## Bulk importer (discovery helper, not the core pool)

The curated pool is the hand list (`games.tsv`, always mainstream). The bulk
importer fills gaps (years, platforms, studios, franchises) from IGDB —
its output always needs review, and niche titles stay out of the default view
via the `popular` flag:

```sh
npm run import -- --years 1980-2025 --top 8      # N best per year
npm run import -- --year 1983 --top 10           # fill a gap year
npm run import -- --company "Sierra Entertainment" --top 50
npm run import -- --platform "SNES" --top 30
npm run import -- --franchise "Star Wars" --top 30
npm run import -- --engine "CryEngine" --top 30
npm run import -- --list-years                   # local per-year counts
```

Ranking uses IGDB `total_rating` with `--min-votes` (default 20 — lower it to ~5
for retro systems whose games have few votes). `--dry` previews, `--no-shots`
skips downloads. Company names must match IGDB
(e.g. `Sierra Entertainment`, not `Sierra` — the dry run prints what it resolved).

## Custom games + enriching blanks

`npm run add-custom` adds one game with your own screenshot (see OPERATIONS).
Only `--id`, `--title`, `--year`, `--image` are required — leave genre,
publisher, developer or platforms empty if you don't know them, then fill
them from IGDB:

```sh
npm run import -- --enrich --dry     # preview what would be filled
npm run import -- --enrich           # fill blanks only, never overwrites
```

Matching is title + release year (this disambiguates reboots: your year
decides between *Lords of the Fallen* 2014 vs 2023). **Your TSV title is
always the display title** — IGDB only donates missing facts, never renames.

## Retro fallback fetcher (Libretro Thumbnails)

For pre-2005 console entries missing an IGDB shot, `npm run fetch:retro` pulls
native-resolution snaps from the Libretro Thumbnails repos (no key needed):

```sh
npm run fetch:retro -- --id mario-world   # single game
npm run fetch:retro -- --all              # everything missing a file
npm run fetch:retro -- --all --dry        # preview matches only
```

It matches our titles against No-Intro ROM names (USA/Europe preferred,
Beta/Proto/Sample excluded), saves `<id>.png` into the year folder, and rewrites
the entry's screenshot path. IGDB shots always win — retro only fills gaps.
Same legal posture as IGDB (fan captures, © publishers, review by hand).

## Discord sharing (no SDK needed)

You chose **external web + link** instead of the Discord Embedded App SDK, so:

1. Click **“Share this level on Discord”** → copies e.g. `https://your-host/?game=elden-ring`.
2. Paste it in any Discord channel. Discord unfurls the link (OG tags in `index.html`);
   anyone opening it plays **exactly that level** (`?game=` is read on load, with a
   “Shared challenge” banner).
3. After solving, **“Copy result for Discord”** copies e.g.
   `🎮 GameGuesser — I guessed Elden Ring (2022) at 16×16 for 250 pts! …` — paste it
   back so the channel can compare scores.

No bot, no SDK, no OAuth. If you later want in-client leaderboards / `shareMoment`,
migrate to a Discord Activity (`@discord/embedded-app-sdk`) — the `?game=` level param
maps 1:1 to an activity `custom_id`.

## Project layout

- `src/data/games.tsv` — hand list source of truth (auto-built to `games.hand.ts`)
- `src/data/games.ts` — types + merged export `GAMES` (hand + auto + custom)
- `src/lib/fuzzy.ts` — tolerant matching (substrings, token subsets, Levenshtein)
- `src/lib/game.ts` — levels/points, rounds, packages (franchise/developer/German/engines),
  share-link + Discord message builders, score storage
- `src/components/PixelCanvas.tsx` — canvas downsample/upscale pixelation
- `src/App.tsx` — game flow (guess → reveal → share → next)
- `scripts/fetch-igdb.mjs` — one-time IGDB screenshot downloader
- `docs/OPERATIONS.md` — run/fetch/deploy/test manual (start here for ops)
