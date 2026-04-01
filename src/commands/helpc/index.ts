import type { Command } from '../../commands.js'

const helpc = {
  type: 'local',
  name: 'helpc',
  description: '查看中文帮助',
  load: () => import('./helpc.js'),
} satisfies Command

export default helpc
