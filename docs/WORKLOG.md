# Work log — plan execution (rev 4 of `.kilo/plans/game-guesser-review.md`)

Resumption guide: `git log --oneline -3` should show the commits below.
Verify with `npx vitest run` (expect 88 tests green), `npx tsc --noEmit` and
`node scripts/audit.mjs`. Authoritative plan: `.kilo/plans/game-guesser-review.md`.
Do not re-litigate §2 decisions.

## 2026-10-05/06 — plan batches (committed)

Landed as `8ae3103` (round persistence, data/tooling cleanup, sales track)
and `e84052e` (autocomplete), both pushed on `feature/persistence`.

### Done
- [x] Loading-hang fix, test harness (jsdom+RTL), PixelCanvas/App/GuessForm tests
- [x] Vite 8, copyPublicDir:false, strip plugin, preconnect, GuessForm split
- [x] Duplicate-key canvas fix + keys regression test
- [x] Autocomplete dismiss/anchor, Soulslikes pack + 9 imports, id/keen/epic imports
- [x] Tetris art fix, shake/checkmark/attempts animations, year slider, exact-match suffix
- [x] Redirect wording, pokemon-blue removal, locknote, honest empty pool + year clamp
- [x] Alias prune (<3 chars) + importer floor
- [x] A1 dedupe: removed 6 same-game dupes, Wind Waker single 2002 entry, gow/TR-2013 own art; shared-URL scan 24 → 0; audit fails on shared remotes
- [x] Vitest isolation (`test.include/exclude`), `.kilo/` gitignored
- [x] Deleted `scripts/tsv-from-ts.mjs`; IDEAS ref fixed
- [x] OPERATIONS conventions (§3c) + ladder copy fix
- [x] backfill-remote year-regex fix (C5)

### In progress
- [x] Plan app bugs: B3 chips lock, B4 repeat-score share text, honest randomFrom + test, NFS dup rule, B0 unknown-share banner + test
- [x] Plan app bugs: B9 dropped count + banner + tests, facet stripping + tests, chips-lock test, keys test extension, shotsFor order test
- [x] Plan: E1 memoized search index, aria-live message/toast, docs drift + favicon, Zelda/CryEngine/Unity + package-size test, B4 repeat test
- [x] Plan: audit exit codes/--strict/--shared-remote/--dupes + comment strip, orphan cleanup (55 files), dupe --fix
- [x] Plan: remove-game hardening (remote-aware --missing, --yes, TSV target), C3 TSV-first ordering (import/fetch/audit/retro), CI gate (test + shared-remote audit), runbook section
- [x] Plan: round persistence (sessionStorage + resume/discard, share links win) + error boundary, with tests
- [x] Round persistence extras: per-level state (level/attempts/wrongs/hints/solved/shot) resumes invisibly, tested
- [x] Content cleanup: fix-data.mjs (self-title aliases, dup platforms, exact-dupe aliases), 255+9 alias drops, 38 platform dedupes, Sonic/Witcher franchise merge, rival-title alias removals (Mega Man numerals, mario bros, metal gear solid, final fantasy, diablo, doom, god of war), credit fixes IGDB-verified (GoW II/III→Sony, Sonic 3→Sega, ALTTP/F-Zero→Nintendo, dropped fake engine), zombies dev left alone (plan was wrong — LucasArts developed it)
- [x] Round history + personal best (localStorage, summary + setup, tested)
- [x] Pool rule groundwork (replaces percentile plan): measurement proved
  signal-based auto-demotion would exile Tetris/Mario/Sonic (near-zero IGDB
  votes for pre-90s classics); explicit `popular` flags stay the mechanism,
  import/backfill share one VOTES_POPULAR threshold, hand TSV gained an
  appended `popular` column for curator overrides
- [x] Sales info track: fetch-sales (Wikidata + Wikipedia, 143 joined), sales.tsv→sales.ts compile, ≈-row on result card, join + formatter tests

## 2026-11-13 — WIP sweep

- [x] Docs refreshed to reality: STATE (88 tests, deploy state, persistence/
  history/sales, pool 1,558), WORKLOG statuses, OPERATIONS new-release routine.
- [x] `audit.mjs` future-date check is now dynamic (`year > current year`);
  the hardcoded 2025 listed every legit 2026 entry on each run.
- [x] `valheim` year corrected to 2021 (IGDB `first_release_date` had drifted
  to a later version), screenshot paths moved with it.
- [x] Comment/format nits: fuzzy "picking submits" wording, `parseSharedPool`
  signature line.
- [x] `App.test.tsx` package test gets an explicit 30s timeout — 17 package
  clicks re-filter the whole pool and sat right at vitest's 5s default.
- [x] Pool refresh 2024–2026: 58 entries imported (`import --year … --top 40`),
  CDN remotes filled with `backfill-remote` (all 58 got `remote` + 2 alts),
  `data:build` + `list` regenerated. Audit: 0 missing/orphans/dupes/shared,
  28 genre review flags. Pool is now 1,616 levels.
- Year drift must be reviewed for early-access titles (IGDB reports the 1.0
  date): `satisfactory` 2024 (EA 2019), `dinkum` 2025 (EA 2022),
  `deltarune` 2025 (chapters since 2018), `project-gorgon` 2026 (EA 2018),
  `soulstone-survivors` 2025, `abiotic-factor` 2025. Left as imported for the
  owner to confirm against §3c's original-release rule.
- [x] Single-level resume (`gameguesser.level`): F5 now restores the same
  game, screenshot and pixelation while the level is unsolved. Round
  snapshots keep priority, the entry is dropped on solve/give-up, and
  `?game=`/`?round=` links still win. Two new tests (90 total).
- CI intentionally runs the fast `audit --shared-remote` gate, not the plan's
  `--strict`: strict also fails on future-dated entries, and imports can
  legitimately land announced titles. Full audit stays a local step.

### Standing decisions (from user + conventions doc)
- Year = original release (JP where differs). Franchise may be cross-franchise tag. Ids frozen (grandfather: lords-of-the-fallen-2023). One entry per game; remakes separate with own art.
- Aliases: no stub acronyms <3 chars; regional titles wanted (siedler etc.).
- Hand-picked ≠ mainstream (user adds games they like): a notability rule must
  judge hand entries by signal too, not auto-include them (overrides plan task 20).
- No committed build artifacts (tsbuildinfo untracked). dist/ excludes screenshots.
- User commits; agent leaves work uncommitted for review.

### Watch-outs
- `shotsFor()` order is frozen — share links encode positional `s=` indices.
- `games.hand.ts` is generated from `games.tsv` (never edit directly; scripts writing it get reverted by data:build).
- `.kilo/worktrees/` belongs to another session — never execute, move, or delete it.
- PowerShell: chain with `;`, avoid `head/tail/cut`, avoid inline `node -e` with regex/quotes (use temp .cjs files instead).
