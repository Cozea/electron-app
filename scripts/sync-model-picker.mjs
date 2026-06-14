// Offline model-picker sync from models.dev.
//
// Pulls the models.dev catalog and diffs it against the hardcoded
// `BUILT_IN_MODELS` arrays that drive the assistant model picker, then emits
// populated capability stubs for anything the picker is missing — so a human
// can paste, eyeball, test, and commit. No runtime network dependency.
//
// models.dev carries the per-model capability detail this picker needs:
//   reasoning_options[].values  -> effort ladder (low/medium/high/xhigh/max)
//   experimental.modes.fast      -> fast mode
//   limit.context                -> context window
//   modalities.input             -> image / pdf support
// The only Cozea-specific bits it can't know are layered overrides — the UI
// default selection and "ultrathink" (a Cozea effort value beyond models.dev's
// ladder) — so the generated stub flags those for you rather than guessing.
//
// Scope: the model PICKER only. Pricing/billing tiers live elsewhere and should
// still be cross-checked against the authoritative provider docs.
//
// Run: `bun run models:sync`  (flags: --json, --since=YYYY-MM-DD)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODELS_DEV_URL = 'https://models.dev/api.json'
const asJson = process.argv.includes('--json')

// models.dev lists every model a provider ever shipped. Keep the diff actionable:
// drop non-conversational models, dated/`-latest` snapshot variants (the picker
// uses the bare alias), and anything older than the cutoff.
const NON_CHAT_RE = /embedding|image|tts|whisper|audio|realtime|moderation|dall-e|deep-research|transcribe|sora/i
const VARIANT_RE = /-\d{8}$|-latest$/
const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.slice('--since='.length)
const SINCE = sinceArg ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const MAX_CANDIDATES = 20

const EFFORT_LABELS = {
  none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium',
  high: 'High', xhigh: 'Extra High', max: 'Max',
}

const PROVIDERS = [
  {
    key: 'claude',
    label: 'Claude (claudeAgent)',
    file: 'electron/assistant-runtime/provider/Layers/ClaudeProvider.ts',
    modelsDevKey: 'anthropic',
    capabilitiesHelper: 'makeClaudeCapabilities',
    perModelCapabilities: true, // helper takes a config object
  },
  {
    key: 'codex',
    label: 'Codex (OpenAI)',
    file: 'electron/assistant-runtime/provider/Layers/CodexProvider.ts',
    modelsDevKey: 'openai',
    capabilitiesHelper: 'makeCodexCapabilities',
    perModelCapabilities: false, // helper takes no args (uniform across codex models)
  },
]

/** Extract the slugs declared inside the file's BUILT_IN_MODELS array. */
function readPickerSlugs(relPath) {
  const text = readFileSync(join(REPO_ROOT, relPath), 'utf8')
  const block = text.match(/const BUILT_IN_MODELS[^=]*=\s*\[([\s\S]*?)\n\]/)
  const scope = block ? block[1] : text
  const slugs = new Set()
  for (const m of scope.matchAll(/\bslug:\s*["']([^"']+)["']/g)) slugs.add(m[1])
  return slugs
}

async function fetchModelsDev() {
  const res = await fetch(MODELS_DEV_URL)
  if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`)
  return res.json()
}

/** Normalize a models.dev model record into the facts the picker cares about. */
function summarizeRemote(id, m) {
  const input = m?.modalities?.input ?? []
  const effort = (m?.reasoning_options ?? []).find((o) => o?.type === 'effort')?.values ?? []
  return {
    id,
    name: m?.name ?? id,
    reasoning: !!m?.reasoning,
    effort,
    fast: !!m?.experimental?.modes?.fast,
    image: input.includes('image'),
    pdf: input.includes('pdf'),
    context: m?.limit?.context ?? null,
    releaseDate: m?.release_date ?? m?.last_updated ?? null,
  }
}

function isPickerRelevant(m) {
  if (!m.context || m.context < 1000) return false // image / embedding / audio
  if (NON_CHAT_RE.test(m.id) || VARIANT_RE.test(m.id)) return false
  if (m.releaseDate && String(m.releaseDate).slice(0, 10) < SINCE) return false
  return true
}

/** Build the makeClaudeCapabilities({...}) body from models.dev facts. */
function claudeCapsBody(m) {
  const lines = []
  if (m.reasoning && m.effort.length) {
    lines.push('      effortOptions: [')
    for (const v of m.effort) lines.push(`        { id: "${v}", label: "${EFFORT_LABELS[v] ?? v}" },`)
    lines.push('      ],')
  } else if (m.reasoning) {
    lines.push('      supportsThinkingToggle: true,')
  }
  if (m.context >= 1_000_000) {
    lines.push('      contextWindowOptions: [')
    lines.push('        { id: "200k", label: "200k", isDefault: true },')
    lines.push('        { id: "1m", label: "1M" },')
    lines.push('      ],')
  }
  if (m.fast) lines.push('      supportsFastMode: true,')
  lines.push('      // Cozea overrides (not in models.dev): mark an effort isDefault,')
  lines.push('      // and add { id: "ultrathink", label: "Ultrathink" } + promptInjectedEffortValues: ["ultrathink"] for thinking models.')
  return lines.join('\n')
}

function scaffold(provider, m) {
  const caps = provider.perModelCapabilities
    ? `    capabilities: ${provider.capabilitiesHelper}({\n${claudeCapsBody(m)}\n    }),`
    : `    capabilities: ${provider.capabilitiesHelper}(),`
  return ['  {', `    slug: "${m.id}",`, `    name: "${m.name}",`, '    isCustom: false,', caps, '  },'].join('\n')
}

async function main() {
  const remote = await fetchModelsDev().catch((err) => {
    console.error(`Failed to fetch models.dev: ${err.message}`)
    console.error('(The picker arrays are unchanged — this is a read-only check.)')
    process.exit(1)
  })

  const report = []

  for (const provider of PROVIDERS) {
    const localSlugs = readPickerSlugs(provider.file)
    const all = Object.entries(remote?.[provider.modelsDevKey]?.models ?? {}).map(([id, m]) =>
      summarizeRemote(id, m),
    )
    const knownIds = new Set(all.map((m) => m.id)) // for "extra" — full set, so a filtered model isn't falsely flagged retired
    const current = all
      .filter(isPickerRelevant)
      .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))

    const missing = current.filter((m) => !localSlugs.has(m.id))
    const extra = [...localSlugs].filter((s) => !knownIds.has(s))

    report.push({ provider: provider.key, missing, extra })
    if (asJson) continue

    console.log(`\n=== ${provider.label} — models.dev/${provider.modelsDevKey}, since ${SINCE} ===`)
    console.log(`picker exposes ${localSlugs.size} model(s); ${current.length} relevant candidate(s)`)

    if (missing.length === 0) {
      console.log('  ✅ no missing models')
    } else {
      const shown = missing.slice(0, MAX_CANDIDATES)
      console.log(`  ⬇️  ${missing.length} in models.dev but NOT in picker (candidates to add):`)
      for (const m of shown) {
        const effort = m.effort.length ? `effort=[${m.effort.join('/')}]` : m.reasoning ? 'reasoning(toggle)' : 'no-reasoning'
        console.log(`     • ${m.id}  (ctx ${m.context}, ${effort}, fast=${m.fast}, img=${m.image}, pdf=${m.pdf}, ${m.releaseDate})`)
      }
      if (missing.length > shown.length) console.log(`     … +${missing.length - shown.length} more (narrow with --since=YYYY-MM-DD)`)
      console.log('\n  Paste-ready stubs (review Cozea overrides before committing):')
      for (const m of shown) console.log(scaffold(provider, m))
    }

    if (extra.length > 0) {
      console.log(`  ⬆️  ${extra.length} in picker but NOT in models.dev (custom, pinned, or retired):`)
      for (const s of extra) console.log(`     • ${s}`)
    }
  }

  if (asJson) console.log(JSON.stringify(report, null, 2))
}

main()
