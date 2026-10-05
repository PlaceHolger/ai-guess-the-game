# Guess the Game — Operations Manual

How to run, extend, fetch, deploy and test the game. Start here for anything
beyond playing.

## 1. First start

Requirements: Node 20+ (`node -v`), npm (`npm -v`).

```sh
cd C:\my_projects\game_guesser
npm install
npm run dev        # -> http://localhost:5173/
```

The game is playable immediately with generated placeholder art. Real
screenshots come later (§4). Production build: `npm run build` (output `dist/`).

> Windows/PowerShell note: chain commands with `;`, not `&&`
> (`npm install; npm run dev`).

## 2. How the game works (30-second version)

- One level = one game. Image starts at **16 wide** (500 pts), each
  **Reveal more** step (16 → 32 → 48 → 64 → 96 → **full**) lowers the points
  (500 / 400 / 300 / 200 / 100 / 50). Going back to a blurrier
  view does **not** restore points.
- Guessing is fuzzy (`src/lib/fuzzy.ts`): typos, regional titles and
  abbreviations (`gta 5`, `ff7`) accepted. Rules: an **exact** title/alias
  match only wins when unique; **numbers in titles are relevant**
  (`resident evil 7` needed, bare `resident evil` asks); **subtitles are
  droppable** (`…: Biohazard` never required). A partial match fitting
  several games asks *which one* ("🔎 Almost — …"); a guess naming the
  distinction (`silent hill 4`, `gothic 2` = `gothic ii`) solves at once.
- **Filters** are multi-select facets (genre / publisher / developer /
  platform / franchise — OR within a facet) plus years +
  decade chips. They define the pool for free play and rounds. **Packages** (📦 row:
  Star Wars, N64, Sierra, Made in Germany, …) are one-click presets over the
  same filters. The default pool is **mainstream only** — tick *niche picks* to
  include niche/homebrew levels. Choices persist in localStorage. Platforms with fewer than 5 games collapse into an "Others" group, and long facet lists have filter boxes.
- Each appearance shows a **random screenshot** of the level (primary +
  alternates rotate for variety); shared links always open the primary shot.
- **Start round** plays 10 random levels from the filtered pool, then shows a
  summary with per-game scores. Stuck? Two **Hint** steps: release year
  first, then the title shape (`______ ____`) — each halves your points
  (min 10). Every 2nd wrong guess auto-reveals
  the next resolution (points drop accordingly).
- **Sharing is link-based, no SDK.** *Copy challenge link* copies an
  opaque `?game=` link (short hash, not the title — no spoilers in chat).
  *Copy result* gives a paste-ready score message for the channel. From a round
  summary you can share any single game plus the whole round result.
  Discord link unfurls need a **public https:// URL** (see §6).

Code map:

| Path | Purpose |
|---|---|
| `src/data/games.tsv` | hand-list source of truth — edit here (see §3b) |
| `src/data/games.hand.ts` | generated from the TSV, do not edit (`npm run data:build`) |
| `src/data/games.ts` | types + merged export `GAMES` (hand + auto + custom) |
| `src/data/games.auto.ts` | bulk-imported entries, do not edit (importer appends) |
| `src/data/games.custom.ts` | your hand-added entries (`add-custom`, §3) |
| `src/lib/fuzzy.ts` | tolerant answer matching |
| `src/lib/game.ts` | levels/points, rounds, share-link + Discord text builders |
| `src/components/PixelCanvas.tsx` | canvas pixelation |
| `src/App.tsx` | game flow, filters, rounds, summary |
| `scripts/igdb-lib.mjs` | shared IGDB helpers (auth, queries, catalog reader) |
| `scripts/fetch-igdb.mjs` | screenshot downloader for catalog entries |
| `scripts/import-igdb.mjs` | bulk entry+metadata importer |
| `scripts/fetch-retro.mjs` | Libretro Thumbnails fallback for retro gaps |
| `scripts/add-custom.mjs` | add one custom game with your own screenshot |
| `scripts/audit.mjs` | pool health: missing shots, orphans, dupes (`--dupes --fix`), exotic flags |
| `scripts/remove-game.mjs` | delete levels (`--id`, `--missing`) |
| `scripts/backfill-auto.mjs` | refresh `popular`/`franchise`/`engine` on bulk entries |
| `scripts/record-alts.mjs` | record on-disk alternates into entries |
| `scripts/build-data.mjs` | compile `games.tsv` → `games.hand.ts` (auto via predev/prebuild) |

## 3. Adding a custom game (your own screenshot)

```sh
npm run add-custom -- --id larry-2 --title "Leisure Suit Larry 2" --year 1988 \
  --genre Adventure --publisher "Sierra On-Line" --developer "Sierra On-Line" \
  --platforms DOS --aliases "larry 2" --image ./shot.png
```

Required: `--id` (lowercase slug), `--title`, `--year` (1970–2026),
`--image` (jpg/png/webp). Optional: `--genre`, `--publisher`, `--developer`
(default `Unknown`), `--platforms` (comma-separated, default `PC`),
`--aliases` (comma-separated), `--igdb-query`, `--force` (overwrite).

What it does: validates the id is unique, copies the image to
`public/screenshots/<year>/<id>.<ext>`, appends the entry to
`src/data/games.custom.ts`. The level is playable after a page reload —
filters, rounds, guessing and sharing pick it up automatically.

## 3b. Editing the hand list (games.tsv)

The 201 curated entries live in `src/data/games.tsv` (UTF-8, tab-separated —
opens in Excel/LibreOffice; keep the year column as text and save back as
UTF-8 TSV). Columns:

`id | title | year | genre | publisher | developer | platforms | aliases | igdbQuery | screenshot | altScreenshots | metacritic | remote | remoteAlts | popular`
(`popular` is `true`/`false`/empty; empty means "judge by default rule".)

Screenshot paths are relative (`screenshots/<year>/<id>.jpg`, no leading
slash) and resolved against the deploy base at runtime, so GitHub Pages
project URLs keep working. `remote`/`remoteAlts` hold the IGDB CDN hotlinks
(`backfill-remote` writes them into the TSV for hand entries); the game
loads remote shots first, local files second.

Lists use `|` (`SNES|Wii`). Empty `aliases`/`igdbQuery`/`altScreenshots`
allowed; empty genre/publisher/developer/platforms can stay empty and be
filled from IGDB later:

```sh
npm run import -- --enrich --dry     # preview fills (title+year matching)
npm run import -- --enrich           # fill blanks only, never overwrites
```

`npm run data:build` compiles the TSV (auto-runs before `dev`/`build`,
fails loudly with line numbers on bad rows). **Your title is always the
display title** — IGDB only donates missing facts; your release year picks
which game a fuzzy name means (*Lords of the Fallen* 2014 vs 2023).

### 3c. Data conventions (read before editing entries)

- **Year = original release date (JP where it differs):** Zelda 1986, Wind
  Waker 2002, Tetris 1984. Don't "fix" these to US/EU dates.
- **`franchise` may be a deliberate cross-franchise tag**, not factual series
  membership (e.g. Soulslike covers FromSoftware souls *and* Hollow Knight,
  Jedi: Survivor, Lies of P — that's what the Soulslikes package is built on).
- **Genre labels are messy by design:** raw IGDB genres for auto entries, the
  hand list's own words for hand entries. Don't normalize them per-item.
- **Alias policy:** aliases must resolve to *this* entry and must never be
  another game's title. Regional/acronym titles are wanted; stub acronyms
  shorter than 3 letters are pruned (`prune-aliases.mjs`, importer floor).
- **Duplicate policy:** one entry per game; a remake gets its own entry *and*
  its own art (sharing a shot between entries makes a level unsolvable).
- **Ids are frozen** (share links + screenshot filenames): never rename an id.
  Grandfathered exception: `lords-of-the-fallen-2023` (renamed before this
  rule). `lords-of-the-fallen` (2014) vs `lords-of-the-fallen-2023` are two
  genuinely different games sharing a title — never collapse them; both
  deliberately carry alias `lf`.

### 3d. Sales figures (info row, not scoring)

`npm run fetch:sales` joins Wikidata units-sold + Wikipedia best-sellers to
pool ids (`src/data/sales.tsv`: id/units/source) and `data:build` compiles it
to `sales.ts`. The result card shows `≈15M copies` (source tooltip) only when
a figure exists — approximate by design (lower bounds, no as-of date).

### 3e. Data hygiene passes

- `node scripts/prune-aliases.mjs --apply` — drops stub acronym aliases (<3 chars).
- `node scripts/fix-data.mjs --apply` — drops self-title aliases, dedupes platforms.
- Both default to dry-run report mode; `games.hand.ts` regenerates via data:build.

## 4. Screenshots: sources and fetchers

Screenshots are **never committed** (gitignored, local-only) and, since the
hotlink switch, **not even hosted by us**: entries carry `remote` CDN URLs
(`backfill-remote`), and the game loads those first, local files second,
placeholder last. So the repo ships titles + metadata + URL strings only —
no keys (scripts use your local `.env`), no images, nothing secret.

Three fetchers, in order of preference:

**a) IGDB (`npm run fetch:screenshots`)** — primary source, publisher-provided
shots. Needs `.env` with `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` from
[dev.twitch.tv/console](https://dev.twitch.tv/console) (register app, type
Confidential, redirect URL `http://localhost` — unused; Twitch account needs
2FA for console access). Downloads the widest shot per entry to
`public/screenshots/<year>/<id>.jpg`, writes `ATTRIBUTION.md`, skips existing
files. `--list` shows the catalog; `-- <id>` fetches one game.

**b) Bulk import (`npm run import`)** — discovery helper for gaps (years,
platforms, studios, franchises, engines). Fills metadata (genre, publisher,
developer, platforms, franchise, engine, aliases) plus screenshots into
`games.auto.ts`. The hand list (`games.tsv`) stays the curated core; bulk
output needs review and niche titles stay out of the default view (`popular`):

```sh
npm run import -- --years 1980-2025 --top 8      # N best per year
npm run import -- --year 1983 --top 10
npm run import -- --company "Sierra Entertainment" --top 50
npm run import -- --platform "SNES" --top 30
npm run import -- --franchise "Star Wars" --top 30
npm run import -- --engine "CryEngine" --top 30
npm run import -- --enrich --dry                 # fill blank fields from IGDB
npm run import -- --list-years
```

Ranking uses IGDB `total_rating` (`--min-votes`, default 20 — lower it to ~5
for retro systems whose games have few votes). `--dry` previews, `--no-shots`
skips downloads. Entries without any IGDB screenshot are skipped. Hand list
always wins dedup (exact + subtitle-aware). Use full IGDB names
(`Sierra Entertainment`, not `Sierra` — dry run prints the resolution).
Erotic content is excluded (`themes != 42`). `npm run backfill` refreshes
`popular`/`franchise`/`engine` on existing bulk entries.

**c) Retro fallback (`npm run fetch:retro`)** — Libretro Thumbnails snaps for
pre-2005 console entries IGDB missed. No key needed.
`--id <game>` / `--all` (+ `--dry`, `--system`, `--refresh`). Matches No-Intro
ROM names (USA/Europe preferred, Beta/Proto/Sample excluded), saves
`<id>.png`, rewrites the entry path. Only fills gaps — IGDB shots win.

**Review duty:** every fetcher ends with manual review. The workflow:

```sh
npm run audit                 # entries without shots, orphan files, suspect metadata
npm run audit -- --year 1990  # focus one year folder
```

Open the year folders in Explorer (thumbnails view) and delete what fails:
covers, logos, title screens, wrong games, broken files. Then sync the
entries to match what you kept:

```sh
npm run sync-shots --dry   # preview: promotes surviving alts, lists bare levels
npm run sync-shots          # apply
```

Deleting one bad screenshot is safe — sync promotes the next surviving
alternate to primary (or the game falls through at runtime), and only
levels with *zero* surviving shots are reported (re-fetch that id with
`npm run fetch:screenshots -- <id>`, or drop the level). Then drop levels
entirely if needed:

```sh
npm run remove -- --id <game>   # removes entry + screenshot (add --keep-shot to keep the file)
```

Deleting *just* image files is safe (fallback chain, see above). Fully
removing a level — entry plus all its shots — needs `npm run remove`:

```sh
npm run remove -- --id <game>                        # one entry + its file
npm run remove -- --missing --auto-only --dry        # preview: auto entries without shots
npm run remove -- --missing --include-hand           # also hand/custom entries (careful!)
```

Bulk mode refuses to run without `--auto-only` or `--include-hand`, and
`--dry` previews first. Note the order matters: fetch *before* you bulk
remove, or you'll delete curated hand entries (e.g. Monkey Island) that only
lack a file. Auto-imported entries always ship with a screenshot, so
`--missing --auto-only` is normally a no-op — the missing ones are almost all
hand-listed retro titles waiting for `fetch:screenshots` / `fetch:retro`.

Evaluated and rejected: MobyGames API (now ~$9.99/mo even non-commercial),
EmuMovies (bulk needs paid membership), ScreenScraper (account + quotas, same
ground as Libretro), vgmuseum.com (ending screens only, no API/license),
"free" claims about thumbnail packs (downloadable ≠ licensed).

## 5. Filters, rounds, sharing — behavior contract

- Filters combine with AND; empty pool shows a notice and disables Next/Skip.
- Changing filters mid-round is locked; picking from the spoiler list exits
  the round. Shared `?game=` links always override filters.
- Round = 10 (or fewer if the pool is smaller), fixed queue at start,
  per-game results recorded on solve *and* give-up, summary with per-game
  share buttons + round result text.
- Score (total + solved count) persists in localStorage; filters too.

## 6. Deploy / upload (for Discord sharing to work)

Discord unfurls and shared links need a public server:

```sh
npm run build        # static files in dist/
```

Upload `dist/*` to any static host (Netlify, Vercel, GitHub Pages, Strato via
FTP, …). Serve over **https** (Discord unfurl + clipboard API need it).
No server component, no env vars, no database. Share links are plain URLs.
`dist/` holds only the app (~1.1 MB JS + index.html): `public/screenshots/`
is dev-only fallback and is NOT copied on build (the game runs off IGDB CDN
remotes — see `npm run audit:remotes`), so deploys stay small.

## 6b. When a script went wrong

Data files are committed, so recovery is `git checkout -- <file>` (or
`git status` to see what changed first). `games.hand.ts` is generated — never
edit it; restore via `npm run data:build`. Local screenshots are gitignored
and re-fetchable (`fetch:screenshots`, `fetch:retro`). Bulk removals always
preview with `--dry` first and apply with `--yes`.

## 7. Testing checklist

- `npm run test` — 80+ vitest cases (fuzzy matrix, sequel rules, data
  integrity incl. no-duplicate-ids/titles, component regressions). Must be green.
- `npm run build` — must pass (typecheck + bundle).
- Guess flow: wrong → close (typo) → correct; points drop per reveal; no
  point restore when going back to blurrier views.
- Fuzzy spot checks: `final fantasy`→FF VII, `gta 5`→GTA V, `the` alone
  rejected, `skyrim`→Skyrim.
- Filters: RPG (all) ≈ only RPGs; a year span like 1988–1997; Sierra shows
  Sierra games; packages (e.g. Made in Germany) show their sets; count line
  `X / N levels` updates; *fan picks* toggle changes the pool size.
- Round: 10 games → summary totals → per-game share links → round result text.
  Replay a round: screenshots vary (rotation), games don't repeat in a session.
  Hints: year first, then title shape (each −50%, min 10 pts), auto-reveal every 2nd wrong guess.
- Share: open a `?game=` link in a fresh tab/private window — exact level,
  banner shown. Paste result text into Discord — formatting intact.
- After data changes: `npm run fetch:screenshots -- --list` count matches
  expectations; `node scripts/import-igdb.mjs --list-years` shows sane
  per-year distribution; no duplicate ids.
- New screenshot: correct year folder, in-game (not cover/logo), opens at
  full reveal without giving away the title in text form.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Twitch asks for OAuth redirect URL | Enter `http://localhost`; unused (client-credentials flow) |
| Twitch demands 2FA | Enable 2FA on the Twitch account first (Settings → Security) |
| Fetcher: `Missing IGDB_CLIENT_ID` | `.env` missing/misnamed next to `package.json` |
| Fetcher saved the wrong game | Year-aware matcher picks exact title + ±1y; check the `note:`/`no confident match` lines, delete the file, `-- <id>` re-fetches. Bundles/DLC/remakes of other years are rejected automatically |
| Duplicate screenshots (`-2` identical) | Fixed at download (byte-hash check); clean existing ones with `npm run audit -- --dupes --fix` |
| Importer finds 0 candidates | Vote threshold too high for old years (`--min-votes 5`), or wrong company/platform name (dry run prints the resolution) |
| `&&` fails in PowerShell | Use `;` to chain commands |
| `npm run build` type error in `games.auto.ts` | Never hand-edit it; re-run the importer or restore from git |
| Game shows placeholder art | Screenshot file missing for that id/year — run §4 fetchers |

## 9. Legal notes (not legal advice)

All screenshots are © their publishers/developers. The project handles this by:
(1) never committing images to git, (2) sourcing via official APIs
(IGDB) or fan archives for local use only, (3) keeping `ATTRIBUTION.md` /
`ATTRIBUTION-RETRO.md`, (4) manual review of every image, (5) no
redistribution of packs. Bulk unreviewed imports weaken (4) — review before
any public deploy.
