# Game Guesser — audit & improvement plan

Rev 4. Nothing implemented. Canonical plan file. Supersedes rev 3 and `docs/REVIEW-PLAN.md`
(rev 1, untracked leftover — delete it; it still advertises retracted findings).

Rev 4 applies the seven required changes from rev-3 review plus three smaller notes, and adds
one newly-discovered blocker (§4, task 2: main and the agent worktree have diverged).

## 1. Corrections to rev 1 — read before executing anything

| Rev 1 claim | Status | Correct position |
|---|---|---|
| Pool = 1,565 / 1,363 auto / 0 custom; 1,122 in default view | **Unverified, superseded** | Owner counts **1,547 / 1,344 / 1**. Not reproducible; re-measure (task 3) and carry none of them forward. |
| "117 tests pass" as a clean baseline | **Contaminated** | 6 test files in `src/`; vitest collected 9. See task 5. |
| A2 "no cross-entry arbitration exists" | **Overstated** | Arbitration does exist; rivals are filtered by `numeralsCovered`. Residual hole is narrow — task 15. |
| `trials-of-mana--1` year 1995 is wrong | **Retracted** | Correct — the SNES original. The "2019 remake" cited shipped 2020. |
| Wind Waker year 2002 is wrong | **Retracted** | Correct — JP original, matching repo convention. The duplicate *entry* is still real (task 11). |
| `star-wars-jedi-survivor → "Soulslike"` is a wrong label | **Retracted** | Deliberate tag. The defect is that tag intent is recorded nowhere — fixed by task 13. |
| `gameCode` 28 bits = P0 | **Demoted to P1** | ~0.5% chance of a collision at current size. **Rev 2 also got the migration wrong** — task 12. |
| E1 "4.27 ms → 0.31 ms", E2 "13 ms per submit" | **Indicative only** | From a throwaway harness, not the app. |
| E3: strip `screenshot` / re-chunk | **Gated** | `shotsFor()` is ordered and `?s=N` is a positional index — task 44. |
| A1 "fix the data" | **Incomplete** | 6 of the 8 pairs are the *same game twice* and need entry removal, not new art. Per-pair table in task 11. |
| Task 31 "or drop the field" | **Withdrawn** | Dropping `screenshot` shifts `shotsFor()` indices and breaks every `?s=N` link — contradicts task 44. Field stays. |
| Batch 5 "manual gate" | **Withdrawn** | Deploys are per-push; a gate needs branch review or a settings change, not workflow code. Real mechanism in §6. |

## 2. Decisions already taken (do not re-litigate)

| Decision | Answer |
|---|---|
| Default pool | **Mainstream-first.** Niche stays opt-in — landing on a game you don't know is the annoying failure mode. |
| Meaning of "mainstream" | "Well known / many copies sold", *not* high average rating. The first attempt used `total_rating` and admitted niche titles, which prompted the switch to a volume signal. |
| How to decide it | **Era-relative volume backbone + free sales data as a minor promotion override.** |
| Sales-figure direction | **Promote only.** A figure pulls a title in, never pushes one out. Figures are often franchise- or platform-level with no "as of" convention (NPD splits by console generation; Pokémon Red/Blue/Yellow are separate items), so a low number can be a recording artifact. Costs are asymmetric: a wrongly promoted game is a slightly harder level; a wrongly demoted one vanishes with no trace. |
| Sales tier is small **by construction** | Coverage is capped — Wikidata P2664 carries ~1,250 video games in all of Wikidata, Wikipedia's best-sellers list ~55 titles — so expect ~**7-16%** of our pool, most of it already clearing any vote threshold. Marginal promotions are **tens of titles, not hundreds**. The percentile is the mechanism; sales is a safety net, and must be documented as non-load-bearing so a future session doesn't promote it into the main path. Its highest-value use is the end-of-round screen. |
| Curating by hand | Rejected — too many titles. |
| Steam / SteamSpy signals | Rejected — retro is ~half the pool and Steam cannot serve it. |
| Ids are frozen | No renames. Ids appear in share links and screenshot filenames. **One grandfathered exception**, see task 13. |
| Backend / leaderboards | Out of scope; the Discord paste flow is the leaderboard. |

## 3. Baseline (use these, not rev 1's)

- Pool: **1,547** = 202 hand TSV rows (`build-data.mjs`, reproducible) + 1,344 auto + 1 custom.
- Build: green, single chunk **1,131 kB** (228 kB gzip).
- Tests: **unusable until task 5.**
- `.env` correctly untracked. `tsconfig.tsbuildinfo` no longer tracked. `docs/REVIEW-PLAN.md` and
  `.kilo/` are untracked leftovers.
- Independently confirmed, safe to act on: A1 (24 shared remote URLs across 8 pairs), B1's
  arithmetic, B2, B3, B4, B0, C1, C2, C3, C5, C9, docs drift.
- **Unverified — re-measure before use:** the "76 entries missing `popular`" count, Zelda = 6 /
  CryEngine = 8 package sizes, the duplicated-platform count behind B5, per-decade entry counts,
  and the sales match rate.

## 4. Tasks, in execution order

### Batch 0 — Snapshot, resolve divergence, re-baseline
1. Commit current state; `.bak` `games.tsv`, `games.auto.ts`, `games.hand.ts`,
   `games.custom.ts`.
2. **Resolve the main / worktree divergence first — everything else is ambiguous until this is
   settled.** `git status` is clean on main at `43b72d4`, while
   `.kilo/worktrees/citrine-aristosuchus/` holds a divergent copy that is *not* merged:
   `pokemon-blue-version` exists at `.kilo/…/games.auto.ts:269` but not in main. Decide which
   tree is the source of truth, merge or discard the other, and do it before any data edit —
   otherwise work lands in a tree that never deploys, or an already-made removal is silently
   lost. This also means the rev-1 measurements came from a tree that no longer matches your
   active work.
3. Re-measure against the settled tree: entries per source file, entries missing `popular`,
   per-decade entry counts, every `PACKAGES` size in the default view. Carry no rev-1 count
   forward.
4. Add `.kilo/worktrees` to `.gitignore`.

### Batch 1 — Test isolation (P0; gates all validation)
5. **Vitest is collecting the agent worktree.** No `vitest.config.ts` and no `test` block in
   `vite.config.ts`, so vitest defaults apply — and its default exclude covers
   `node_modules`/`dist`/`.git`/`.cache`, **not** `.kilo/`. Four more test files sit at
   `.kilo/worktrees/citrine-aristosuchus/src/{App,lib/fuzzy,lib/game,data/games}.test.*`, inside
   the project root. Git-aware tooling skips them because `.kilo/.gitignore` exists; vitest does
   not read `.gitignore`, which is why this is invisible to a casual check.
   - Scope: this is duplicated execution, not runtime cross-contamination — each test file
     resolves its own module graph inside its own tree. But the worktree's tests assert against
     worktree data that main does not have, so a green run can be green for the wrong reason.
   - Add `test: { include: ['src/**/*.test.{ts,tsx}'], exclude: ['.kilo/**', 'dist/**'] }`.
     `defineConfig` from `vite` does not type the `test` key — import it from `vitest/config`, or
     add `/// <reference types="vitest/config" />`.
   - Re-run, record the real count as the new baseline. **Why P0:** duplicated stale tests make a
     broken fix look green, and the tests this plan adds are worthless as a signal until it is
     fixed. The deploy workflow (task 48) has never run the suite at all.

### Batch 2 — Data-loss prevention
6. **Delete `scripts/tsv-from-ts.mjs`** (C1). It reads `src/data/games.ts`, which no longer
   contains `HAND_GAMES`, matches 0 blocks, and unconditionally overwrites `games.tsv` with a
   header-only file (`:38`) — no row-count guard, no backup, and its header (`:13`) lacks
   `remote`/`remoteAlts` anyway. Superseded by `build-data.mjs`; `docs/IDEAS.md:47` still cites
   it. This also explains the "1 custom" being the parsed comment example.
7. **Fix `remove-game.mjs`** (C2) — the most dangerous command in the repo.
   - `--missing` judges entries by *local* files only (`blockShots:22-33`), but the pool is
     CDN-hotlinked and local screenshots are gitignored, so on a fresh clone it classifies
     ~1,300 playable entries as shot-less. Treat `remote`/`remoteAlts` as present.
   - Require `--yes` plus a printed count before any bulk delete.
   - `FILES:12` omits `games.tsv`, so `--id <hand-game>` reports success, deletes images, and
     the level returns on the next `data:build`.
8. **Fix the TSV/`.ts` edit-target ordering** (C3). Four scripts patch the *generated*
   `games.hand.ts`, and the next `data:build` silently reverts it — and `data:build` runs
   automatically before `dev` and `build`: `import-igdb.mjs:317` (`put` is first-wins and reads
   `games.hand.ts` before `games.tsv` at `:336`, so `tsvLine` is never set for the 202 hand ids
   and `patchEntry:357` takes the `.ts` branch) · `fetch-igdb.mjs:81` (`entryFile` prefers
   `games.hand.ts` → `setAlts:95`) · `fetch-retro.mjs` `patchScreenshotPath` · `audit.mjs`
   `compactAlts` (used by `--fix`). One change — resolve the target by checking `games.tsv`
   first — repairs all four.
9. **Atomic writes + backups** (C4). 15 scripts `writeFile` straight onto the data files. Add
   `writeAtomic()` (tmp + rename) and `backupFile()` to `igdb-lib.mjs`; route every write
   through them.
10. **`audit.mjs` must be able to fail** (C10) and must ignore comments (C9). It always exits 0
    (`:132`) even with missing screenshots, orphans and dupes; set `process.exitCode = 1`, with
    `--strict` for the exotic checks. Strip `//` lines here and in `list-games.mjs` — reuse
    `igdb-lib.mjs:88`, which already does — and delete the dead guard at `list-games.mjs:19`.

### Batch 3 — The two confirmed high-value fixes
11. **A1 — two games share one screenshot.** 24 URLs across 8 pairs. **Per-pair decision, not a
    blanket "fix the data"** — six of these are the same game entered twice and need *removal*,
    not new art:

    | Pair | Same game? | Action |
    |---|---|---|
    | `dune-2` ↔ `dune-ii-the-building-of-a-dynasty` | Yes — both Dune II (1992) | Remove one |
    | `baldurs-gate-3` ↔ `baldurs-gate-iii` | Yes — both Baldur's Gate III (2003) | Remove one |
    | `fallout` ↔ `fallout-a-post-nuclear-role-playing-game` | Yes — both Fallout (1997); the long id is only the IGDB subtitle | Remove one, keep `fallout` |
    | `alan-wake-2` ↔ `alan-wake-ii` | Yes — both Alan Wake 2 (2023) | Remove one |
    | `wind-waker` ↔ `the-legend-of-zelda-the-wind-waker` | Yes — both Wind Waker (JP 2002) | Remove one |
    | `gow-2018` ↔ `god-of-war--1` | Probably both God of War (2018) | Verify, then remove one |
    | `gow` (2005) ↔ the 2018 entry | No — different games | 2005 entry needs its own art |
    | `tomb-raider` (1996) ↔ `tomb-raider-2013` | No — different games | 2013 entry needs its own art |
    | `pokemon-red-blue` ↔ `pokemon-red-version` | Combined cart vs Red alone — judge per the duplicate policy | Per-item; note `pokemon-blue-version` was removed in the worktree, so confirm which tree this lands in (task 2) |

    - **Which entry survives:** keep the one with more complete metadata (more remotes, better
      platform coverage), preferring the shorter/canonical id where that is the only difference
      (`fallout` over the long subtitle form).
    - Removing an entry kills any share link pointing at it. That is the unavoidable cost; task
      27 turns it from a silent wrong game into an honest "that level is no longer in the pool".
    - After the per-pair pass, add `audit --shared-remote` so it cannot return.
    - Likely root cause is C5 (task 35): its dead year matching is exactly the mismatch that puts
      a predecessor's art on a remake. Re-check pairs after C5; some may self-heal.
12. **`gameCode` — fix the entropy without breaking every posted link.** `findSharedGame`
    (`game.ts:239-241`) matches the code against `gameCode(g.id)` and falls back to a **plain
    id**, not an old-hash code — so changing the hash changes the output for every id and every
    link ever posted stops resolving, which combined with task 27 would silently serve a random
    game.
    - Keep the current function as `legacyGameCode`, exported, with a comment on why and when it
      may be dropped.
    - Add `gameCode` returning a properly-mixed code that uses both accumulators (widen to 9
      chars so entropy is unambiguous).
    - `findSharedGame` tries, in order: new code → legacy code → plain id. Two extra `find`
      passes over ~1,547 entries; immaterial.
    - Never prefix or version the visible code — it must stay opaque in chat.

### Batch 4 — Conventions first, then per-item content cleanup
13. **Document the data conventions before touching content data.** Rev 1 sent two reviewers
    into wrong conclusions because these were implicit. A short section in `docs/OPERATIONS.md`
    plus one-line comments at the decision sites must state: **year = original release date, JP
    where it differs** (Zelda 1986, Wind Waker 2002, Tetris 1984); **`franchise` may be a
    deliberate cross-franchise tag**, not factual series membership; **genre labels are raw IGDB
    genres** for auto entries and the hand list's own words for hand entries, so the facet is
    expected to be messy; **alias policy** — aliases must resolve to *this* entry and may not be
    another game's title, regional/acronym titles are wanted; **duplicate policy** — one entry
    per game, a remake gets its own entry and its own art.
    **Grandfather `lords-of-the-fallen-2023` explicitly** — that id was a deliberate rename made
    before the freeze decision, and without a note someone will "fix" it back to something
    consistent. Note alongside it that `lords-of-the-fallen` (2014) and
    `lords-of-the-fallen-2023` are two **genuinely different games that share a title**, so the
    duplicate policy must *not* collapse them (contrast task 11's table) — and that both carry
    alias `lf`, which is a policy decision rather than an obvious error (task 15).
14. **Re-verify every content item individually before editing.** Rev 1 inferred these by
    pattern-matching 1,344 auto entries and got two wrong. Confirm from a source first:
    - Franchise labels that genuinely break packages: `Legend of Zelda` vs `Zelda` (9),
      `Sonic The Hedgehog` vs `Sonic` (3), `Sid Meier` vs `Civilization` (2),
      `Witcher` vs `The Witcher`). 34 entries disagree with their own title-derived rule — a
      review list, not a fix list.
    - `super-smash-bros-brawl → "Metroid"`, `pinball--3 → "Mario"`,
      `bare-knuckle-iii → "Streets of Rage"`, `donpachi → "Dodonpachi"` (typo),
      `pole-position → "Formula 1"`, `atomic-punk → "Bomberman"`,
      `nier-replicant → "Drakengard"`, `galaga-88 → "Galaxian"`. Same class as Jedi Survivor —
      verify intent, don't assume.
    - Duplicated platforms within an entry (`magic-jewelry` `NES|NES|NES`, `windjammers`
      `Arcade|Neo Geo|Neo Geo`, `star-wars--1` `Game Gear|NES|NES`, 40+ more) — B5's input.
    - Aliases that are another game's title (`teenage-mutant-ninja-turtles-iii-…--1` →
      "…turtles 2: the manhattan project"; `patrician-iii` → a Patrizier 2 title;
      `battletoads--3` → `battletoads 2`).
    - Self-duplicated aliases and alias-equals-own-title in 9 entries (`volfied` has both).
    - Orphan `--N` id suffixes and the leaked UUID id `ghostbusters-79683bac-…`. **Leave them** —
      ids are frozen (§2), and grandfathered per task 13.
15. **A2 residual — verify, don't assume.** `fuzzy.ts:134` sets
    `candidates = [game.title, ...game.aliases]`, so an alias is **exactly as strong as the
    title** — there is no confidence tier. The collision surface for aliases is therefore the
    same size as for titles, and the highest-risk subset is the **auto-imported acronyms** from
    IGDB `alternative_names` (`lf`, `dk`, `pp`, `sf`, `dd`, `sh`, `do`, `dos`), because nobody
    chose them and nobody reviewed them. The existing guards are sound and must not be touched:
    exact match has no length floor (`:140`), containment requires `minLen >= 4` (`:144`), the
    token-subset rule needs guess "substance" (`:157`), and typo tolerance is skipped for
    candidates under 4 chars (`:170`) — so `lff` cannot solve `lf`.
    The real remaining risk is narrow: rivals are filtered by `numeralsCovered`, which returns
    `true` for any numeral-free guess (`:68`), so a guess whose numeral the rival doesn't cover
    drops that rival from the "Almost" prompt and can win the current game silently. Test the
    suspects (`god of war`/`gow`, `dk`, `sh`, `sf`, `dd`, `dcdrr`, `pp`, `do`, `dos`, `baseball`,
    `the settlers`, `mario tennis`, `metal gear solid`, `lttp`, `pokemon red`, and **`lf`** for the
    two Lords of the Fallen entries) against the real pool, report which actually mis-solve, fix
    only those. Note `lf` may well behave correctly — the disambiguation prompt is the designed
    path — so this is a confirmation task, not a presumed bug.
    **Decide and document** (task 13) whether an acronym alias may be claimed by more than one
    entry, rather than assuming the duplicate is an error.
16. **Package sizes.** Zelda = 6 and CryEngine = 8 are unverified. Re-measure (task 3), then fix
    by normalizing labels or matching engine families by prefix instead of `===`
    (`CryEngine 3`, `Cryengine 2`, `Unity3D`, `Unity 6` are currently missed). Add the
    package-size assertion from §7 either way.
17. **`npm run fix-data`** — one dry-run-first command wrapping tasks 13-14.
18. **`npm run review` — contact sheet with persistent verdicts.** A sheet with no log re-shows
    all ~1,300 images every run, which is not incremental. Add a small committed verdict log
    (e.g. `review/verdicts.tsv`, `id<TAB>shotIndex<TAB>ok|bad<TAB>note`) and render only
    unverified shots; verdicts accumulate so each pass shrinks the queue. `bad` verdicts feed
    task 11's per-pair pass and `audit --shared-remote`.

### Batch 5a — Notability core (the actual A3 fix)
Defect: `popular` is written by exactly one script, self-described as a "one-time enrich pass"
(`backfill-auto.mjs:1`), from `rating_count >= 25` (`:11, :62`). `import-igdb.mjs` never writes it
although it already fetches `rating_count` (`GAME_FIELDS:35`) and filters on it (`:42`).
`isPopular` (`game.ts:350`) resolves a *missing* flag to `true`. So every auto entry appended
since the last full `npm run backfill` has no flag, and the next routine backfill silently
reclassifies them — **a maintenance command changes the default pool with no record of why.**
Two unrelated thresholds are in play: import admits `rating_count >= 20`, popularity needs ≥ 25.
This is not a claim the affected titles are obscure; it is that the split is invisible,
non-reproducible, and ordered by command history.

19. **Emit the raw signal.** Write `votes` (IGDB `rating_count`) from `toEntry` in
    `import-igdb.mjs` — already in hand.
20. **Use provenance, not a new TSV column.** Eight scripts index TSV cells positionally
    (`build-data.mjs:43-45`, `list-games.mjs:13`, `import-igdb.mjs:341/361-364`,
    `record-alts.mjs:52-55`, `sync-shots.mjs:61-72`, `backfill-aliases.mjs:71-79`,
    `backfill-metacritic.mjs:81-84`, `backfill-remote.mjs:58-62`), so a 15th column is an
    eight-script migration. Instead build a hand/custom id Set once at module load — `GAMES` is
    `[...HAND_GAMES, ...AUTO_GAMES, ...CUSTOM_GAMES]` — and branch on origin: hand and custom
    entries are curated, therefore mainstream; auto entries are judged by signal.
21. **Make the rule era-relative — but measure first.** `rating_count >= 25` is an *absolute* cut
    and so structurally excludes old titles: a 1983 arcade game will never reach 25 raters, a
    2024 indie hit clears it easily. A percentile *within each entry's own decade* targets "well
    known relative to its peers" and needs no new data. Before choosing the constant, check task
    3's per-decade counts: a percentile over a decade holding a handful of entries is noise, and
    if any decade is thin the bucketing must change (decade → era bands, or a single global
    percentile). Choose the number only after seeing the distribution; keep it as one named
    constant.
22. **Make gaps visible instead of silent.** An auto entry with no `votes` and no sales figure is
    *not* mainstream, and `npm run audit` lists those plus the borderline band per decade so the
    split can be reviewable by hand.
23. **`npm run refresh-votes`** as an occasional manual maintenance command (existing backfill
    pattern), deliberately not in `prebuild`. `votes` is a snapshot and drifts.

### Batch 5b — Sales data track (deliberately separable from 5a)
Split out because, by this plan's own arithmetic (task 24), the sales machinery serves *tens* of
titles. It must not be able to stall the core fix in 5a — **ship 5a first and treat 5b as an
independent, droppable increment.** None of 5a depends on anything here.

24. **Fetch and compile.** New committed `src/data/sales.tsv` (`id<TAB>unitsSold<TAB>source`),
    populated once by `npm run fetch:sales`:
    - **Wikidata P2664 "units sold"** — ~1,250 video games carry a figure; one SPARQL query, no
      key, CC0:
      `SELECT ?game ?gameLabel ?copies WHERE { ?game wdt:P2664 ?copies . ?game wdt:P31/wdt:P279* wd:Q7889 . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?copies)`
    - **Wikipedia "List of best-selling video games"** via the MediaWiki API — ~55 cited titles
      at ≥25M units.
    - Join to our entries by title + year using the existing `normTitle` / `matchBest`
      normalisation. **Do not** use `checkGuess` — it is deliberately fuzzy and would mis-join.
    - Record the source per row, since figures are often franchise- or platform-level with no
      "as of" convention.
    - **The script's primary output is its match rate** (matched / total, plus unmatched
      figure-bearing titles). Expect ~7-16%; a much lower rate means the join needs fixing, not
      the threshold.
    - Compile `sales.tsv` → `src/data/sales.ts` in `build-data.mjs`, same pattern as
      `games.tsv` → `games.hand.ts`. Do **not** add a column to `games.tsv` (task 20). ~5-8 kB.
25. **Show it on the end-of-round screen.** The post-solve `.gameinfo` block (`App.tsx:989-994`)
    already renders `Genre`, `Publisher · Developer`, `Platforms`, `Metacritic` — and `Metacritic`
    is exactly the precedent: an optional fact rendered conditionally. Add one row in the same
    style, looked up as `sales[game.id]`.
    - Render **only when a figure exists**; an always-present empty row reads as "unknown sales"
      rather than "no published figure".
    - Present as an approximate reported figure (`≈15M copies`) with the source in a `title`
      tooltip — these are lower bounds with no "as of" date. Never print false precision.
    - Do **not** add it to the roundlist rows (`App.tsx:734-772`), the share text, or scoring.
26. **Promotion path.** `isPopular` gains one clause: a title in `sales.tsv` at or above the
    floor is mainstream regardless of percentile. ~Five lines. It rescues the case the
    percentile structurally misses — a genuine blockbuster with a tiny IGDB footprint (film
    licenses, old casual/sports titles, non-English markets). **Promote only** (§2). Also revives
    the "best sellers" package `docs/IDEAS.md:18-19` rejected for lack of data.

### Batch 6 — App bugs
27. **B2 — an empty package/filter silently becomes the whole pool.** `App.tsx:320`
    `pool = poolBase.length > 0 ? poolBase : filtered.length > 0 ? filtered : GAMES`. With Zelda
    selected the screen says "No games match this package" (`:871`) while the counter beside it
    (`:856`) reports the fallback size, and **Start round builds 10 unrelated games** (`:419`).
    Drop both fallbacks so the empty state is honest, **and add the code guard, not just disabled
    buttons**: with no fallback the pool can be empty, and `randomFrom` (`game.ts:49-52`) returns
    `list[Math.floor(Math.random() * list.length)]` — `undefined` on an empty array, while typed
    as non-optional `GameEntry`, so callers reading `.id` throw. Either make the return type
    honest (`GameEntry | undefined`) with an early return, or guard at each call site
    (`nextFreePick`, `pickGame`, the free-play button). Also fix its type lie.
28. **B3 — package chips ignore the round lock.** Every other control is disabled (`:815, :828,
    :845, :850, :855, :863`) and `.locknote` styling sells the lock, but the chips at `:779-787`
    have no `disabled` and `pickPackage` (`:400`) rewrites `filters` mid-round.
29. **B0 — an unknown `?game=` silently plays a random game.** `App.tsx:206-213` falls through to
    `randomGame()` with no message. Needs an explicit "that level is no longer in the pool"
    state. **This is what turns task 12's migration bug from degraded into silent, so it must
    land in the same deploy as task 12 or before it.**
30. **B4 — shared result text overstates the score.** `App.tsx:574` caps a repeat solve at 10
    pts, but `:1004` recomputes `earnedPoints(maxLevel, hintStage)`, so a replayed game announces
    500 pts while the counter added 10.
31. **B6 — filters from storage and URLs are unvalidated.** `loadFilters` (`App.tsx:148`) spreads
    whatever JSON held; `parseSharedPool` (`game.ts:183`) accepts any integer years and any facet
    string. Clamp years to `YEAR_MIN..YEAR_MAX`, repair `ymin > ymax`, and for facet values
    **strip unknown values rather than rejecting the whole link** — strict rejection combined with
    no-fallback (task 27) means one stale value in an old shared link loses the player's intended
    filter or empties the pool outright. Dropping the unknown value degrades to a slightly broader
    pool; rejecting loses the link.
32. **B5 — `PLATFORM_COUNTS` counts occurrences, not distinct platforms** (`App.tsx:44-46`),
    which with the duplicated platforms in task 14 can push a rare platform past
    `RARE_PLATFORM_COUNT` (`game.ts:212`). Re-measure the duplicate count first.
33. **B9 — `findSharedRound` silently drops unknown codes** (`game.ts:144-151`), so the queue
    shrinks and `i` points at a different game than intended. Warn instead.
34. **B7 — the local screenshot fallback is broken; fix it, don't remove the field.** `vite.config.ts:28`
    sets `base: './'`, so `resolveShot` (`game.ts:248-252`) resolves against the *page* URL
    (`/user/repo` without a trailing slash drops the last segment), and `copyPublicDir: false`
    (`:34`) never ships `public/screenshots`. **Rev 3 offered "drop the field" as an option — that
    is withdrawn.** `shotsFor()` (`game.ts:256-262`) pushes `screenshot` in at index 1 whenever it
    differs from `remote`, so removing it would shorten the array and repoint every existing
    `?s=N` link, contradicting task 44. Keep the field, fix `resolveShot`, and either enable
    `copyPublicDir` or correct the README's claim.
35. **B8 + B0b — reload loses the round; nothing catches a render throw.** `roundQueue` is seeded
    only from `?round=` (`:245`); everything else is component state. Persist queue + results +
    position to `sessionStorage`, and add an error boundary in `main.tsx`. Precedence: an explicit
    `?game=`/`?round=` link always wins and clears the stored round; otherwise offer "Resume
    round"; "New round" and "⚙" clear it. Silent auto-resume would fight share links.

### Batch 7 — Docs and scripts
36. **Docs drift.** Levels are **16 → 32 → 48 → 64 → 96 → Full at 500 / 400 / 300 / 200 / 100 /
    50** (`game.ts:12`), but `README.md:3`, `App.tsx:1064` (in-app "How scoring works"),
    `index.html:7` and `:9`, `docs/STATE.md:13` and `docs/IDEAS.md:14` still describe the old
    4×4 / 1000-pt ladder. `index.html` also lacks `og:image` (Discord unfurls with no art),
    `twitter:card`, a favicon (404 every load) and a manifest. `docs/STATE.md` still cites the old
    test count and pool size.
37. **C5 — `backfill-remote.mjs:30,33` year regex can never match.** `str(n)` needs a quoted value
    but `year` is a bare number, so `year` is `undefined` for every entry and `matchBest`'s
    `yearOk` (`igdb-lib.mjs:138`) is always false — likely A1's root cause. `backfill-metacritic.mjs:36`
    and `audit.mjs:210` already use the correct numeric pattern.
38. **C6 — IGDB client resilience.** `igdb-lib.mjs:49-57` throws on 429/5xx with no backoff (IGDB
    allows 4 req/s; the scripts run 2-3 requests per game); the Twitch token is never cached or
    refreshed on 401; the secret travels in a query string (`:41`). `backfill-metacritic.mjs`
    hammers RAWG with no sleep on the skip/failure paths.
39. **C7 — numeric flags unvalidated.** `--top abc` and `--years 2020-` silently yield zero
    candidates and report "0 fresh entries"; `--limit 0` is falsy so it processes everything;
    `--year` is ignored when `--years` is also passed.
40. **C8 — `build-data.mjs` brittleness.** `:28` doesn't CR-tolerate the header while the file's own
    comment (`:9`) says to use Excel, which writes CRLF → the check at `:33` throws and `predev`
    blocks. `:50` hardcodes `year > 2026`; `:58` accepts `metacritic: 999`; `q()` (`:20-24`)
    doesn't escape backslashes.
41. **C11 — invented metadata.** `import-igdb.mjs:244` writes `platforms: ['PC']` when every real
    platform was filtered out; `:552-568` appends entries whose screenshot download failed or was
    skipped with `--no-shots`; `--title` (`:509-519`) takes the first 3 hits without `matchBest`
    verification.
42. **Housekeeping.** Missing `metacritic` + `backfill-aliases` npm scripts; unescaped `id`
    interpolated into regexes in 6 scripts; `backfill-auto.mjs:89` is O(file × entries); dead
    `qq()` (`import-igdb.mjs:353`); duplicate `PLAT_BY_ABBR` keys; unreachable `mapPlatform`
    branches; duplicate `Need for Speed` rule (`game.ts:308` and `:336`); `GERMAN_PATTERNS` has no
    blank guard and unbounded `/yager/i`, `/black forest/i`; the 0-byte `empty` file is still
    tracked (`tsconfig.tsbuildinfo` is no longer tracked — that line is done); `game.ts:9-11` claims
    points "fall linearly".
43. **Runbook.** `docs/OPERATIONS.md` has no "a script went wrong" procedure. Add one: `git
    checkout -- src/data/games.tsv src/data/games.auto.ts`, which works only because the data is
    in git.

### Batch 8 — Perf and polish
44. **E3 — bundle, gated on share-link stability.** 1,131 kB in one chunk. `shotsFor()` returns an
    **ordered** array and `?game=…&s=N` encodes a *positional index* into it; `roundLink` does the
    same per game (`code~shotIdx`). Any field removal, reorder, or re-chunk silently repoints
    every existing link — which is why task 34's "drop the field" option was withdrawn. Either
    keep the field order and array shape byte-stable and strip only provably-unread fields, or
    version the parameter and accept that old links lose their exact frame (acceptable — the game
    still loads via task 12's resolver). Treat the regex-based `stripUnusedGameFields` plugin
    (`vite.config.ts:9-23`) as a risk surface: it already rewrites source with
    `.replace(/,\s*}/g, '}')`, so any new rule needs a build-output check.
45. **E1 — memoize the normalized catalog.** `GuessForm.tsx:37` and `App.tsx:343` re-normalize
    ~1,547 titles plus ~3,500 aliases on every keystroke. Build once at module load and share.
46. **E2 — bound the submit-time fuzzy scan.** `App.tsx:561` and `:591` run `checkGuess` across
    the catalog. Add the standard `|len(a) − len(b)| > threshold ⇒ skip` guard and a first-token
    prefilter before Levenshtein.
47. **Keyboard, a11y, minor.** ↑/↓/Enter in the suggestion list; `R` reveal, `H` hint, `S` skip;
    `aria-live` on message and toast; `aria-pressed`/`aria-current` on level chips; focus moved to
    the summary; stop `autoFocus` (`GuessForm.tsx:66`) popping the keyboard on every level.
    Uncleaned `shotHistRef`/`flash` timeouts. `earnedPoints` floors at 10 (`game.ts:41`), so at the
    50-pt tier the hints yield 25 then 12 and are nearly free — raise the floor per tier or disable
    them near full reveal. Saved lists can hold ids removed by `npm run remove` (`App.tsx:139`).

### Batch 9 — CI, then features
48. **CI gate.** Add `npm test` + `npm run build` + `npm run audit -- --strict` to
    `.github/workflows/deploy.yml`, which today runs only `npm ci` + `npm run build`. Land only
    after task 5, or CI inherits the contamination.
49. **Features, once 1-6 are stable.** Round history / personal bests (`IDEAS.md:4-5`) · daily
    challenge, date-seeded, `?daily=YYYY-MM-DD` (`IDEAS.md:13`) · escalating non-pixel hints
    (first letter / word count / decade as stages 3-4) · the "best sellers" package task 26 makes
    possible.

## 5. What is approved as-is

Batches 0-1 green-lighted by rev-3 review, unchanged in substance. Batches 2+ approved subject
to §1's seven changes, all applied above.

## 6. Rollout and migration

- **No workflow-level gate exists.** `deploy.yml` triggers on every push to `main`, so each batch
  ships on merge. Rev 3's "hold Batch 5 behind a manual gate" was not implementable as written and
  is withdrawn. The real mechanisms, in order of cost:
  1. Land on a branch, run `npm test`, `npm run audit -- --strict`, and the pool-size check
     locally, then merge. Zero infrastructure.
  2. Optionally add a GitHub **environment protection rule** on `github-pages` requiring a
     reviewer — a repository *settings* change, not workflow code.
  3. Adding `workflow_dispatch` to `deploy.yml` enables manual deploys but does **not** suppress
     the push trigger; do not mistake it for a gate.
- **Every data-mutating batch (2, 4, 5a, 5b, 7) lands as its own commit** so one `git revert`
  undoes it.
- **Share links** are the one real migration. Old `?game=` codes keep working via task 12's legacy
  lookup; old `?s=N` frame indices keep working only while `shotsFor()` order is frozen (task 44).
  Decide the `s=` policy *before* touching the data shape.
- **Data rollback** is `git checkout -- src/data/…`; it works because the data is committed, and
  that is the reason not to move it out of git.
- **Order inside Batch 4:** conventions (13) → re-measure (16) → per-item cleanup (14-15). Never
  the reverse.
- **5a and 5b are independent.** 5a is the fix for A3; 5b is a separable increment that can be
  dropped without regressing anything.

## 7. Validation

Task 5 must land first — until then no pass/fail signal is meaningful.

Add alongside each fix:
- `gameCode`: fixed-corpus collision assertion for the new code; a fixed corpus of **legacy** codes
  that must still resolve (guards task 12's migration); plain-id links still resolving.
- Every `PACKAGES` entry yields ≥ `ROUND_SIZE` in the default view — catches the Zelda/CryEngine
  class permanently.
- No two entries share a `remote` URL — catches A1.
- `GAMES` invariants: unique ids, unique `title|year`, no alias equal to its own title, every
  entry has ≥1 platform and a `remote`, every auto entry has `votes`.
- `isPopular`: missing `votes` **and** no sales figure ⇒ not mainstream; a `sales.tsv` title above
  the floor is mainstream *regardless* of percentile (task 26) but a sales figure **below** it
  never demotes; the default pool stays within a sane size band so a broken rule cannot silently
  empty or flood it.
- `sales.tsv` join: every id resolves to a real entry (no orphaned rows); no id carries conflicting
  figures.
- End-of-round screen renders the sales row **only** when a figure exists, with the `≈` prefix —
  snapshot-test the empty case so a missing figure never renders as a blank or zero-valued row.
- **Keep `App.test.tsx:71` ("uses unique keys for siblings") permanently** — we just lived through
  that bug class. Extend it to cover every list-rendered collection in the app, not just the one
  that broke, so a new `.map()` cannot reintroduce sibling key collisions.
- `parseSharedPool` / `loadFilters`: clamp out-of-range years; **strip** unknown facet values while
  keeping the known ones.
- A round survives `pickGame` + reload; `?game=` still overrides a stored round.
- `randomFrom([])` returns `undefined` (or throws by contract) rather than a non-optional
  `GameEntry`, and no caller dereferences it unguarded.
- `resolveShot` under `base: './'` with and without a trailing slash; `shotsFor()` output length
  and order unchanged for a known entry (guards task 44).

Per-batch checks:
- Data batches (2, 4, 5a, 5b, 7): `git diff --stat src/data/` shows only intended files, and
  **`games.hand.ts` is byte-identical before and after any script run** — the task-8 canary
  (`npm run data:build` twice; the second must be a no-op per `git status`).
- After Batch 4 *and* after Batch 5a: re-measure every package size against the then-current
  default view. 5a moves the pool in **either** direction and Star Wars was already marginal.
- Batch 6 manual pass: unknown `?game=`, Zelda + Start round, a package chip mid-round, a replayed
  game → "Copy result as text", `?ymin=3000`, refresh mid-round, and a pre-fix share link opened
  after the `gameCode` change.
- Every batch: `npm run build` green, no unexplained bundle growth, test count equal to the
  post-task-5 baseline plus only the new tests.

## 8. Risks

- **Divergence is the top risk** (task 2): two copies of the app and data exist, main is clean,
  the worktree is unmerged and untracked. Every task's target is ambiguous until it is settled,
  and it is why the rev-1 baseline no longer matches the active work.
- **Sequencing:** Batch 4 must precede any content edit, and Batch 5a changes the pool Batch 4's
  sizes were measured against. Re-measure at both boundaries.
- **The two deliberate-decision traps** (Soulslikes tagging, original-release years) are fixed by
  documenting them plus grandfathering `lords-of-the-fallen-2023`. Any session that skips task 13
  re-introduces the same false positives.
- **Retro is the weak half.** ~half the pool is pre-2000 and no free sales source covers it, so
  retro rests entirely on the era-relative backbone. If that feels wrong in play, the honest lever
  is a hand-curated retro shortlist — a better automatic signal does not exist for free.
- **`votes` is a snapshot** and drifts; `refresh-votes` is manual by choice.
- **Sales coverage is a hard ceiling, not a scraping shortfall.** ~7-16% of the pool will have any
  figure and task 26 moves only tens of titles. If it looks broken later, check the match rate
  before blaming the rule — and resist promoting it into the main mechanism.
- **Sales figures are lower bounds without an "as of" date** (task 25), hence the `≈` prefix and
  source tooltip.
- **Two numbers need tuning by feel** once data exists: the decade percentile (task 21) and the
  units-sold floor (task 26). Both are single named constants by design, and task 21 forbids
  choosing the percentile before the distribution is measured.
- **No per-screenshot "human verified" flag.** ~1,300 images are unreviewed, so such a flag would
  empty the default pool; the incremental `review/verdicts.tsv` log (task 18) is the answer instead.

## 9. Out of scope

No Steam/SteamSpy tier (retro gets nothing from it) · no `vgsales.fandom.com` scraping (top-N
tables, not a per-title join) · no VGChartz (no free API, community-acknowledged inaccuracy) · no
paid data source · no bundling screenshots into git · no framework change · no hand review of the
~1,300 unreviewed images · no id renames beyond the grandfathered one · no workflow-level deploy
gate (§6) · no unresolved design questions remain.