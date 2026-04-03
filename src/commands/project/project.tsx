import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  createProject,
  deleteProject,
  listProjects,
  switchProject,
  getActiveProject,
  renameProject,
} from '../../services/projects/registry.js'
import type { Project } from '../../services/projects/types.js'

function formatProjectTable(
  projects: Project[],
  activeId: string | null,
): string {
  if (projects.length === 0) {
    return '  No projects yet. Create one with: /project create <name>'
  }

  const lines: string[] = ['']
  lines.push('  Projects:')
  lines.push('')

  for (const p of projects) {
    const marker = p.id === activeId ? ' \u25B6 ' : '   '
    const date = new Date(p.lastActiveAt).toLocaleDateString()
    const info = p.rootPath ? ` (${p.rootPath})` : ''
    lines.push(`  ${marker}${p.id === activeId ? `${p.name}` : p.name} [${p.id}]${info} — active: ${date}`)
  }

  lines.push('')
  lines.push('  Commands:')
  lines.push('    /project create <name>             Create a new project')
  lines.push('    /project list                      List all projects')
  lines.push('    /project switch <name-or-id>       Switch to a project')
  lines.push('    /project activate <name-or-id>     Activate a project (alias for switch)')
  lines.push('    /project clear                     Clear active project')
  lines.push('    /project deactivate                Deactivate project (alias for clear)')
  lines.push('    /project delete <name-or-id>       Delete a project')
  lines.push('    /project rename <id> <new>         Rename a project')
  lines.push('    /project info                      Show active project details')
  lines.push('')

  return lines.join('\n')
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  const input = args.trim()

  // /project (no args) — show current + list
  if (!input) {
    const active = getActiveProject()
    const all = listProjects()
    const header = active
      ? `  \u25B6 Active project: ${active.name} [${active.id}]`
      : '  No active project (using default cwd mode).'
    onDone(header + formatProjectTable(all, active?.id ?? null), {
      display: 'system',
    })
    return null
  }

  // /project create <name>
  if (input.startsWith('create')) {
    const name = input.replace(/^create\s*/, '').trim()
    if (!name) {
      onDone('Usage: /project create <name>', { display: 'system' })
      return null
    }
    try {
      const project = createProject({ name })
      onDone(
        `  Project created: ${project.name} [${project.id}]\n  Memory and sessions will be scoped to this project.`,
        { display: 'system' },
      )
    } catch (e: unknown) {
      onDone(`  ${e instanceof Error ? e.message : String(e)}`, {
        display: 'system',
      })
    }
    return null
  }

  // /project list
  if (input === 'list') {
    const active = getActiveProject()
    const all = listProjects()
    const header = active
      ? `  \u25B6 Active project: ${active.name} [${active.id}]`
      : '  No active project.'
    onDone(header + formatProjectTable(all, active?.id ?? null), {
      display: 'system',
    })
    return null
  }

  // /project switch <name-or-id>
  if (input.startsWith('switch')) {
    const target = input.replace(/^switch\s*/, '').trim()
    if (!target) {
      onDone('Usage: /project switch <name-or-id>', { display: 'system' })
      return null
    }

    const all = listProjects()
    const matched =
      all.find(p => p.id === target) ??
      all.find(p => p.name.toLowerCase() === target.toLowerCase()) ??
      all.find(p => p.id.startsWith(target.toLowerCase()))

    if (!matched) {
      onDone(
        `Project "${target}" not found. Run /project list to see available projects.`,
        { display: 'system' },
      )
      return null
    }

    try {
      const project = switchProject(matched.id)
      if (project) {
        onDone(
          `  Switched to project: ${project.name} [${project.id}]\n  Memory and sessions will now be scoped to this project.`,
          { display: 'system' },
        )
      }
    } catch (e: unknown) {
      onDone(`  ${e instanceof Error ? e.message : String(e)}`, {
        display: 'system',
      })
    }
    return null
  }

  // /project clear — deactivate project scoping
  if (input === 'clear' || input === 'unset' || input === 'clear-default') {
    switchProject(null)
    onDone('  Active project cleared. Back to default cwd mode.', {
      display: 'system',
    })
    return null
  }

  // /project activate <name-or-id> — alias for switch
  if (input.startsWith('activate')) {
    const target = input.replace(/^activate\s*/, '').trim()
    if (!target) {
      onDone('Usage: /project activate <name-or-id>', { display: 'system' })
      return null
    }

    const all = listProjects()
    const matched =
      all.find(p => p.id === target) ??
      all.find(p => p.name.toLowerCase() === target.toLowerCase()) ??
      all.find(p => p.id.startsWith(target.toLowerCase()))

    if (!matched) {
      onDone(
        `Project "${target}" not found. Run /project list to see available projects.`,
        { display: 'system' },
      )
      return null
    }

    try {
      const project = switchProject(matched.id)
      if (project) {
        onDone(
          `  Activated project: ${project.name} [${project.id}]\n  Memory and sessions will now be scoped to this project.`,
          { display: 'system' },
        )
      }
    } catch (e: unknown) {
      onDone(`  ${e instanceof Error ? e.message : String(e)}`, {
        display: 'system',
      })
    }
    return null
  }

  // /project deactivate — alias for clear
  if (input === 'deactivate') {
    switchProject(null)
    onDone('  Project deactivated. Back to default cwd mode.', {
      display: 'system',
    })
    return null
  }

  // /project delete <name-or-id>
  if (input.startsWith('delete')) {
    const target = input.replace(/^delete\s*/, '').trim()
    if (!target) {
      onDone('Usage: /project delete <name-or-id>', { display: 'system' })
      return null
    }

    if (deleteProject(target)) {
      onDone(`  Project "${target}" deleted.`, { display: 'system' })
    } else {
      // Try by id
      const all = listProjects()
      const matched =
        all.find(p => p.id === target) ??
        all.find(p => p.id.startsWith(target.toLowerCase()))
      if (matched && deleteProject(matched.id)) {
        onDone(`  Project "${matched.name}" [${matched.id}] deleted.`, {
          display: 'system',
        })
      } else {
        onDone(`Project "${target}" not found.`, { display: 'system' })
      }
    }
    return null
  }

  // /project rename <id> <new-name>
  if (input.startsWith('rename')) {
    const parts = input.replace(/^rename\s*/, '').trim().split(/\s+/)
    if (parts.length < 2) {
      onDone('Usage: /project rename <id> <new-name>', { display: 'system' })
      return null
    }
    const [id, ...rest] = parts
    const newName = rest.join(' ')
    try {
      const project = renameProject(id!, newName)
      onDone(`  Project [${id}] renamed to "${project.name}".`, {
        display: 'system',
      })
    } catch (e: unknown) {
      onDone(`  ${e instanceof Error ? e.message : String(e)}`, {
        display: 'system',
      })
    }
    return null
  }

  // /project info — show active project details
  if (input === 'info') {
    const active = getActiveProject()
    if (!active) {
      onDone('  No active project.', { display: 'system' })
      return null
    }
    const created = new Date(active.createdAt).toLocaleString()
    const lastActive = new Date(active.lastActiveAt).toLocaleString()
    const lines = [
      '',
      `  Name:     ${active.name}`,
      `  ID:       ${active.id}`,
      `  Root:     ${active.rootPath ?? '(not set)'}`,
      `  Created:  ${created}`,
      `  Active:   ${lastActive}`,
      '',
    ]
    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // Unknown subcommand
  onDone(
    `Unknown subcommand: "${input}"\nAvailable: create, list, switch, activate, clear, deactivate, delete, rename, info`,
    { display: 'system' },
  )
  return null
}
