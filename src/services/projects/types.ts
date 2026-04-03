/**
 * Project system types.
 *
 * A Project represents a named workspace grouping multiple sessions under a
 * shared memory namespace and configuration context.
 */

import type { SessionId } from '../../types/ids.js'

export type ProjectId = string

export type Project = {
  /** Unique project identifier (slugified name) */
  id: ProjectId
  /** Display name */
  name: string
  /** Path to the project's root directory (for file context) */
  rootPath?: string
  /** ISO date when the project was created */
  createdAt: string
  /** ISO date when the project was last active */
  lastActiveAt: string
  /** Session IDs belonging to this project (ephemeral, not persisted) */
  sessionIds?: SessionId[]
}

export type ProjectCreateOptions = {
  /** Human-readable name (required) */
  name: string
  /** Optional absolute path for the project root */
  rootPath?: string
  /** Optional description for the project */
  description?: string
}

export type ProjectRegistry = {
  /** Map of project id → metadata */
  projects: Record<ProjectId, Omit<Project, 'sessionIds'>>
  /** Currently active project id (null = use default cwd-based behavior) */
  activeProjectId: ProjectId | null
}

export const PROJECTS_REGISTRY_FILENAME = 'projects-registry.json'
