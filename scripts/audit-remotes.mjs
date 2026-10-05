// Check every hotlinked IGDB CDN screenshot (remote + remoteAlts) with an
// HTTP HEAD (Range-GET fallback where HEAD is refused). Read-only report.
// Usage:
//   npm run audit:remotes              # full check (~1-2k URLs, takes minutes)
//   npm run audit:remotes -- --primary # only each game's primary remote
// Exit 1 when a game has no live remote shot left (fallthrough exhausted).
import { readCatalog } from './igdb-lib.mjs'

const CONCURRENCY = 10
const TIMEOUT_MS = 20000

const norm = (u) => (u.startsWith('//') ? 'https:' + u : u)

async function once(url, useRange) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: useRange ? 'GET' : 'HEAD',
      headers: useRange ? { Range: 'bytes=0-0' } : {},
      signal: ctrl.signal,
      redirect: 'follow',
    })
    return { ok: res.ok, status: res.status }
  } finally {
    clearTimeout(t)
  }
}

/** HEAD, falling back to a 1-byte Range GET (some CDNs refuse HEAD). */
async function check(url) {
  try {
    let r = await once(url, false)
    if (!r.ok && (r.status === 403 || r.status === 405)) r = await once(url, true)
    if (r.ok) return r
    // one retry on server errors / throttling, not on 404s
    if (r.status >= 500 || r.status === 429) {
      await new Promise((res) => setTimeout(res, 2000))
      return once(url, false)
    }
    return r
  } catch {
    // network error / timeout: single retry, then dead
    await new Promise((res) => setTimeout(res, 2000))
    try {
      return await once(url, false)
    } catch {
      return { ok: false, status: 0 }
    }
  }
}

async function main() {
  const primaryOnly = process.argv.includes('--primary')
  const catalog = await readCatalog()
  // url -> set of game ids using it (dedupes: same CDN file often repeats)
  const users = new Map()
  const games = []
  for (const g of catalog) {
    const primary = g.remote ?? null
    const alts = [...new Set(g.remoteAlts ?? [])].filter((a) => a !== primary)
    games.push({ id: g.id, title: g.title, year: g.year, primary, alts })
    for (const u of [primary, ...alts]) {
      if (!u) continue
      if (!users.has(u)) users.set(u, new Set())
      users.get(u).add(g.id)
    }
  }
  const urls = [...users.keys()]
  console.log(`${catalog.length} games, ${urls.length} unique remote URLs to check (concurrency ${CONCURRENCY})...`)

  const status = new Map()
  let done = 0
  const queue = [...urls]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const u = queue.pop()
        status.set(u, await check(norm(u)))
        if (++done % 200 === 0) console.log(`  ... ${done}/${urls.length}`)
      }
    }),
  )

  const deadPrimary = [] // {id, title, year, liveAlts, dead}
  const deadAlts = [] // {id, title, year, deadAlt}
  const noRemote = []
  for (const g of games) {
    const shots = [
      ...(g.primary ? [{ u: g.primary, primary: true }] : []),
      ...g.alts.map((u) => ({ u, primary: false })),
    ]
    if (primaryOnly && g.primary) {
      const r = status.get(g.primary)
      if (!r?.ok) deadPrimary.push({ ...g, liveAlts: 0, dead: [`primary ${r?.status ?? '?'} (${g.primary})`] })
      continue
    }
    if (shots.length === 0) {
      noRemote.push(g)
      continue
    }
    const live = shots.filter((s) => status.get(s.u)?.ok)
    const dead = shots.filter((s) => !status.get(s.u)?.ok)
    if (g.primary && !status.get(g.primary)?.ok) {
      deadPrimary.push({
        ...g,
        liveAlts: live.length,
        dead: dead.map((s) => `${s.primary ? 'primary' : 'alt'} ${status.get(s.u)?.status ?? '?'} (${s.u})`),
      })
    }
    for (const d of dead.filter((s) => !s.primary)) {
      deadAlts.push({ ...g, deadAlt: `${status.get(d.u)?.status ?? '?'} (${d.u})` })
    }
  }

  console.log(`\n-- games with a DEAD primary remote (${deadPrimary.length}) --`)
  for (const g of deadPrimary) {
    console.log(`  ${g.liveAlts > 0 ? 'ALT-OK ' : 'NO-LIVE'} ${g.id} (${g.year} — ${g.title})`)
    for (const d of g.dead) console.log(`           ${d}`)
  }
  if (!primaryOnly) {
    console.log(`\n-- games with dead remote alts, primary alive (${deadAlts.length}) --`)
    for (const g of deadAlts.slice(0, 60)) console.log(`  ${g.id}: ${g.deadAlt}`)
    if (deadAlts.length > 60) console.log(`  ... +${deadAlts.length - 60} more`)
  }
  console.log(`\n-- games with no remote shots at all (${noRemote.length}) --`)
  for (const g of noRemote.slice(0, 30)) console.log(`  ${g.id} (${g.year} — ${g.title})`)
  if (noRemote.length > 30) console.log(`  ... +${noRemote.length - 30} more`)

  const noLive = deadPrimary.filter((g) => g.liveAlts === 0).length + noRemote.length
  console.log(`\n${urls.length} URLs checked: ${[...status.values()].filter((r) => r.ok).length} alive, ${[...status.values()].filter((r) => !r.ok).length} dead.`)
  console.log(`Games with no live remote shot: ${noLive}.`)
  console.log('Fix dead entries by re-running the IGDB fetch for the game or removing the URL; local files are fallback-only.')
  if (noLive > 0) process.exitCode = 1
}

main()
