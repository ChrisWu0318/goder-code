/**
 * Project registry manager.
 *
 * Persists project metadata and active project selection in
 * ~/.claude/projects-registry.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { getClaudeConfigHomeDir, isEnvDefinedFalsy } from '../../utils/envUtils.js'
import type { Project, ProjectCreateOptions, ProjectId, ProjectRegistry } from './types.js'
import { PROJECTS_REGISTRY_FILENAME } from './types.js'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default'
}

function getRegistryPath(): string {
  const dir = getClaudeConfigHomeDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  return `${dir}/${PROJECTS_REGISTRY_FILENAME}`
}

function readRegistry(): ProjectRegistry {
  const path = getRegistryPath()
  if (!existsSync(path)) {
    return { projects: {}, activeProjectId: null }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as ProjectRegistry
    return {
      projects: parsed.projects || {},
      activeProjectId: parsed.activeProjectId ?? null,
    }
  } catch {
    return { projects: {}, activeProjectId: null }
  }
}

function writeRegistry(registry: ProjectRegistry): void {
  const path = getRegistryPath()
  writeFileSync(path, JSON.stringify(registry, null, 2), { mode: 0o600 })
}

/**
 * Create a new project and persist it in the registry.
 * Returns the created project object.
 */
export function createProject(options: ProjectCreateOptions): Project {
  const registry = readRegistry()
  const id = slugify(options.name)

  if (registry.projects[id]) {
    throw new Error(`Project "${id}" already exists. Use /project switch ${id} to activate it.`)
  }

  const now = new Date().toISOString()
  registry.projects[id] = {
    id,
    name: options.name,
    rootPath: options.rootPath ?? undefined,
    createdAt: now,
    lastActiveAt: now,
  }

  // Auto-switch to the new project
  registry.activeProjectId = id

  writeRegistry(registry)

  const project: Project = {
    ...registry.projects[id],
  }

  return project
}

/**
 * Delete a project from the registry.
 */
export function deleteProject(id: ProjectId): boolean {
  const registry = readRegistry()

  if (!registry.projects[id]) {
    return false
  }

  delete registry.projects[id]

  if (registry.activeProjectId === id) {
    registry.activeProjectId = null
  }

  writeRegistry(registry)
  return true
}

/**
 * List all projects.
 */
export function listProjects(): Project[] {
  const registry = readRegistry()
  return Object.values(registry.projects).map(p => ({ ...p }))
}

/**
 * Get a project by id.
 */
export function getProject(id: ProjectId): Project | undefined {
  const registry = readRegistry()
  if (!registry.projects[id]) return undefined
  return { ...registry.projects[id] }
}

/**
 * Switch the active project.
 */
export function switchProject(id: ProjectId | null): Project | undefined {
  const registry = readRegistry()

  if (id === null) {
    registry.activeProjectId = null
    writeRegistry(registry)
    return undefined
  }

  if (!registry.projects[id]) {
    throw new Error(`Project "${id}" not found.`)
  }

  registry.activeProjectId = id
  registry.projects[id]!.lastActiveAt = new Date().toISOString()
  writeRegistry(registry)

  return { ...registry.projects[id]! }
}

/**
 * Get the currently active project.
 */
export function getActiveProject(): Project | null {
  const registry = readRegistry()
  if (!registry.activeProjectId) return null
  const project = registry.projects[registry.activeProjectId]
  if (!project) return null
  return { ...project }
}

/**
 * Get the active project id (or null).
 */
export function getActiveProjectId(): ProjectId | null {
  return readRegistry().activeProjectId
}

/**
 * Rename a project.
 */
export function renameProject(id: ProjectId, newName: string): Project {
  const registry = readRegistry()
  if (!registry.projects[id]) {
    throw new Error(`Project "${id}" not found.`)
  }
  registry.projects[id]!.name = newName
  writeRegistry(registry)
  return { ...registry.projects[id]! }
}
