import type { Command } from '../../types/command.js'

const project = {
  type: 'local-jsx',
  name: 'project',
  description: 'Manage projects — group sessions and isolate memory per project',
  immediate: true,
  argumentHint: '[create|list|switch|info]',
  load: () => import('./project.js'),
} satisfies Command

export default project
