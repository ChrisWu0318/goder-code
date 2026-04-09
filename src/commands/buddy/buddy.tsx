import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import {
  getCompanion,
  roll,
  rollWithSeed,
  companionUserId,
} from '../../buddy/companion.js'
import { renderSprite } from '../../buddy/sprites.js'
import {
  RARITY_STARS,
  SPECIES,
  STAT_NAMES,
  type Species,
  type StoredCompanion,
} from '../../buddy/types.js'

const NAMES: Record<string, string[]> = {
  duck: ['Quackers', 'Waddle', 'Ducky', 'Puddles'],
  goose: ['Honkers', 'Goosebert', 'Maverick', 'Untitled'],
  blob: ['Blobby', 'Squish', 'Gloop', 'Wobble'],
  cat: ['Whiskers', 'Mittens', 'Mochi', 'Neko'],
  dragon: ['Ember', 'Sparky', 'Draco', 'Blaze'],
  octopus: ['Inky', 'Tentacle', 'Octo', 'Squidward'],
  owl: ['Hootie', 'Owlbert', 'Sage', 'Noctua'],
  penguin: ['Waddles', 'Pingu', 'Tux', 'Frosty'],
  turtle: ['Shelldon', 'Turbo', 'Tortellini', 'Snapper'],
  snail: ['Shelly', 'Slime', 'Spiral', 'Escargot'],
  ghost: ['Boo', 'Phantom', 'Casper', 'Spooky'],
  axolotl: ['Axel', 'Lotl', 'Gilly', 'Newt'],
  capybara: ['Cappy', 'Bara', 'Chillington', 'Capybro'],
  cactus: ['Spike', 'Prickle', 'Needles', 'Verde'],
  robot: ['Beep', 'Circuit', 'Bolt', 'Robo'],
  rabbit: ['Bunbun', 'Hops', 'Clover', 'Thumper'],
  mushroom: ['Shroom', 'Truffle', 'Fungi', 'Spore'],
  chonk: ['Chonkers', 'Thicc', 'Biggie', 'Floof'],
  pikachu: ['Pikachu', 'Sparky', 'Volt', 'Pika'],
  chubit: ['Dumpling', 'Bubu', 'Mochi', 'Blobbi'],
}

const PERSONALITIES: Record<string, string[]> = {
  duck: ['Loves bread crumbs', 'Quacks at bugs', 'Obsessed with ponds'],
  goose: ['Chaotic energy', 'Will steal your code', 'Honks at errors'],
  blob: ['Extremely chill', 'Vibes with everything', 'No bones, no problems'],
  cat: ['Judges your code silently', 'Sleeps on keyboard', 'Knocks things off tables'],
  dragon: ['Breathes fire at bad PRs', 'Hoards golden commits', 'Guards the codebase'],
  octopus: ['Eight arms, eight terminals', 'Ink-based debugging', 'Multitasker supreme'],
  owl: ['Wise beyond compile time', 'Night owl coder', 'Sees all bugs'],
  penguin: ['Linux enthusiast', 'Slides into DMs', 'Cool under pressure'],
  turtle: ['Slow and steady wins the race', 'Shell-shocked by deadlines', 'Carries home everywhere'],
  snail: ['Takes it slow', 'Leaves a trail of commits', 'Home is where the shell is'],
  ghost: ['Haunts abandoned repos', 'Invisible in code reviews', 'Spooky good at debugging'],
  axolotl: ['Regenerates deleted code', 'Always smiling', 'Aquatic vibes'],
  capybara: ['Friends with everyone', 'Maximum chill', 'The zen of coding'],
  cactus: ['Prickly about code style', 'Thrives with neglect', 'Desert-tested resilience'],
  robot: ['Beeps at syntax errors', '01001000 01101001', 'Efficiency is everything'],
  rabbit: ['Hops between files fast', 'Multiplies test cases', 'Carrot-driven development'],
  mushroom: ['Grows in dark repos', 'Spore-adic brilliance', 'Fun guy to work with'],
  chonk: ['Absolute unit', 'Sits on bugs to squash them', 'Round is a shape'],
  pikachu: ['Shocks bad code away', 'Pika pika!', 'Electric debugging energy'],
  chubit: ['Too cute to debug', 'Falls asleep on keyboard', 'Maximum squish'],
}

// Bun bundler strips 0x1b bytes for security. Construct escapes at runtime.
const ESC = String.fromCharCode(27)
const RESET = `${ESC}[0m`
const CYAN = `${ESC}[36m`       // sprite outlines
const MAGENTA = `${ESC}[35m`    // accent / name
const YELLOW = `${ESC}[33m`     // shiny stars
const GREEN = `${ESC}[32m`      // stat bars
const DIM = `${ESC}[2m`         // dim text
const BOLD = `${ESC}[1m`        // bold text
const BRIGHT_YELLOW = `${ESC}[93m`  // golden sparkle

function statBarColor(val: number): string {
  if (val >= 80) return GREEN
  if (val >= 50) return YELLOW
  return `${ESC}[31m`  // red
}

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`
}

function formatCompanionCard(isNew: boolean): string {
  const companion = getCompanion()
  if (!companion) return 'No companion found.'

  const stars = RARITY_STARS[companion.rarity]
  const sprite = renderSprite(companion, 0)
  const lines: string[] = []

  if (isNew) {
    lines.push('')
    lines.push(colorize('  ~ Your companion has hatched! ~', BOLD + MAGENTA))
    lines.push('')
  }

  // Colorize sprite lines (the ASCII art body)
  const coloredSprite = sprite.map(line =>
    line.replace(/\//g, colorize('/', CYAN))
        .replace(/\\/g, colorize('\\', CYAN))
        .replace(/</g, colorize('<', CYAN))
        .replace(/>/g, colorize('>', CYAN))
        .replace(/\(/g, colorize('(', CYAN))
        .replace(/\)/g, colorize(')', CYAN))
        .replace(/`/g, colorize('`', CYAN))
        .replace(/~/g, colorize('~', MAGENTA))
        .replace(/_/g, colorize('_', DIM))
        .replace(/\^/g, colorize('^', BRIGHT_YELLOW))
        .replace(/\{/g, colorize('{', CYAN))
        .replace(/\}/g, colorize('}', CYAN))
        .replace(/\|/g, colorize('|', CYAN))
        .replace(/\[/g, colorize('[', CYAN))
        .replace(/\]/g, colorize(']', CYAN))
        .replace(/-/g, colorize('-', DIM))
        .replace(/=/g, colorize('=', CYAN))
        .replace(/✦/g, colorize('✦', BRIGHT_YELLOW))
  )

  // Build side-by-side: sprite on left, info on right
  const rarityText = companion.rarity === 'golden'
    ? colorize(`${companion.rarity}`, BOLD + YELLOW)
    : companion.rarity
  const shinyText = companion.shiny ? colorize(' (shiny!)', BOLD + YELLOW) : ''
  const speciesText = colorize(companion.species, BOLD + CYAN)
  const starsColored = stars.split('').map(s =>
    s === '✦' ? colorize(s, YELLOW) : colorize(s, DIM)
  ).join('')

  const infoLines: string[] = [
    `  ${colorize(companion.name, BOLD + MAGENTA)}`,
    `  ${speciesText}${shinyText} ${starsColored} ${rarityText}`,
    `  ${colorize(`"${companion.personality}"`, DIM)}`,
    '',
  ]
  for (const stat of STAT_NAMES) {
    const val = companion.stats[stat]
    const filled = Math.floor(val / 10)
    const empty = 10 - filled
    const barColor = statBarColor(val)
    const bar = colorize('\u2588'.repeat(filled), barColor) + colorize('\u2591'.repeat(empty), DIM)
    infoLines.push(`  ${colorize(stat.padEnd(10), DIM)} ${bar} ${val}`)
  }

  const maxLines = Math.max(coloredSprite.length, infoLines.length)
  for (let i = 0; i < maxLines; i++) {
    const left = (coloredSprite[i] ?? '').padEnd(14)
    const right = infoLines[i] ?? ''
    lines.push(`  ${left}${right}`)
  }

  lines.push('')
  lines.push(colorize('  Commands: ', DIM) + colorize('/buddy pet', CYAN) + colorize(' | ', DIM) + colorize('/buddy switch <species>', CYAN) + colorize(' | ', DIM) + colorize('/buddy mute', CYAN) + colorize(' | ', DIM) + colorize('/buddy unmute', CYAN))
  lines.push(colorize('  Species:  ', DIM) + SPECIES.join(colorize(', ', DIM)))

  return lines.join('\n')
}

function generateSoulForSpecies(
  species: string,
  seed: number,
): { name: string; personality: string } {
  const speciesNames = NAMES[species] ?? ['Buddy']
  const speciesPersonalities = PERSONALITIES[species] ?? ['A loyal companion']
  return {
    name: speciesNames[seed % speciesNames.length]!,
    personality: speciesPersonalities[seed % speciesPersonalities.length]!,
  }
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  const subcommand = args.trim().toLowerCase()

  // /buddy pet
  if (subcommand === 'pet') {
    const companion = getCompanion()
    if (!companion) {
      onDone("You don't have a companion yet! Type /buddy to hatch one.", {
        display: 'system',
      })
      return null
    }
    context.setAppState(prev => ({
      ...prev,
      companionPetAt: Date.now(),
    }))
    onDone(`You petted ${companion.name}!`, { display: 'system' })
    return null
  }

  // /buddy mute
  if (subcommand === 'mute') {
    saveGlobalConfig(c => ({ ...c, companionMuted: true }))
    onDone("Companion muted. They'll stay quiet until you /buddy unmute.", {
      display: 'system',
    })
    return null
  }

  // /buddy unmute
  if (subcommand === 'unmute') {
    saveGlobalConfig(c => ({ ...c, companionMuted: false }))
    onDone('Companion unmuted!', { display: 'system' })
    return null
  }

  // /buddy max — golden mode with maxed stats
  if (subcommand === 'max') {
    saveGlobalConfig(c => ({
      ...c,
      companionRarityOverride: 'golden',
    }))
    onDone('✨ Golden mode activated! Your companion is now MAXED OUT with golden sparkle.', { display: 'system' })
    return null
  }

  // /buddy switch <species> — switch to a specific species
  if (subcommand.startsWith('switch')) {
    const targetSpecies = subcommand.replace('switch', '').trim()
    if (!targetSpecies) {
      onDone(
        `Usage: /buddy switch <species>\nAvailable: ${SPECIES.join(', ')}`,
        { display: 'system' },
      )
      return null
    }
    if (!SPECIES.includes(targetSpecies as Species)) {
      onDone(
        `Unknown species "${targetSpecies}".\nAvailable: ${SPECIES.join(', ')}`,
        { display: 'system' },
      )
      return null
    }

    // Generate deterministic soul for the chosen species
    const userId = companionUserId()
    const seed = `${userId}-${targetSpecies}-switch`
    const { bones, inspirationSeed } = rollWithSeed(seed)
    const { name, personality } = generateSoulForSpecies(
      targetSpecies,
      inspirationSeed,
    )

    const stored: StoredCompanion = {
      name,
      personality,
      hatchedAt: Date.now(),
    }
    saveGlobalConfig(c => ({ ...c, companion: stored }))

    // Clear the roll cache so getCompanion() picks up the change.
    // Since rollWithSeed uses a custom seed, bones from roll(userId) won't
    // match the chosen species. We store the species override in config and
    // override bones.species at read time. But that's complex — simpler:
    // we rely on the stored soul + regenerated bones (which are cosmetic).
    // The species displayed comes from bones (deterministic from userId),
    // BUT the user wants to SEE their chosen species. So we need to store
    // the species override.
    saveGlobalConfig(c => ({
      ...c,
      companion: stored,
      companionSpeciesOverride: targetSpecies,
    }))

    onDone(
      `Switched to ${targetSpecies}! Say hello to ${name}!\n\n${formatCompanionCard(true)}`,
      { display: 'system' },
    )
    return null
  }

  // /buddy info
  if (subcommand === 'info') {
    const companion = getCompanion()
    if (!companion) {
      onDone("You don't have a companion yet! Type /buddy to hatch one.", {
        display: 'system',
      })
      return null
    }
    onDone(formatCompanionCard(false), { display: 'system' })
    return null
  }

  // /buddy (no args) — hatch or show
  const existing = getCompanion()
  if (existing) {
    onDone(formatCompanionCard(false), { display: 'system' })
    return null
  }

  // Hatch a new companion
  const userId = companionUserId()
  const { bones, inspirationSeed } = roll(userId)
  const { name, personality } = generateSoulForSpecies(
    bones.species,
    inspirationSeed,
  )

  const stored: StoredCompanion = {
    name,
    personality,
    hatchedAt: Date.now(),
  }
  saveGlobalConfig(c => ({ ...c, companion: stored }))

  onDone(formatCompanionCard(true), { display: 'system' })
  return null
}
