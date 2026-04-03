import * as React from 'react'
import { useState } from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Box, Text } from '../../ink.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import { isThinkingForced, toggleThinking } from '../../utils/thinkingToggle.js'

function applyThinking(enable: boolean): void {
  if (isThinkingForced() !== enable) {
    toggleThinking()
  }
}

function ThinkingPicker(t0: {
  currentlyEnabled: boolean
  onDone: (msg: string) => void
}) {
  const { currentlyEnabled, onDone } = t0
  const [enableThinking, setEnableThinking] = useState(currentlyEnabled)

  const handleConfirm = () => {
    applyThinking(enableThinking)
    if (enableThinking) {
      onDone('Thinking mode ON — model will think before responding')
    } else {
      onDone('Thinking mode OFF')
    }
  }

  const handleCancel = () => {
    const message = currentlyEnabled
      ? 'Kept thinking mode ON'
      : 'Kept thinking mode OFF'
    onDone(message, { display: 'system' })
  }

  const handleToggle = () => {
    setEnableThinking(prev => !prev)
  }

  useKeybindings(
    {
      'confirm:yes': handleConfirm,
      'confirm:nextField': handleToggle,
      'confirm:next': handleToggle,
      'confirm:previous': handleToggle,
    },
    { context: 'Confirmation' },
  )

  const exitState = { pending: false, keyName: 'Esc' }

  return (
    <Dialog
      title={<Text>Deep thinking mode</Text>}
      subtitle={
        enableThinking
          ? 'Model will think thoroughly before each response, using reasoning to solve complex problems'
          : 'Responses will be more direct without explicit reasoning'
      }
      onCancel={handleCancel}
      inputGuide={
        <Text>
          {exitState.pending ? `Press ${exitState.keyName} again to exit` : 'Tab to toggle · Enter to confirm · Esc to cancel'}
        </Text>
      }
    >
      <Box flexDirection="column" gap={0} marginLeft={2}>
        <Box flexDirection="row" gap={2}>
          <Text bold>Deep thinking</Text>
          <Text bold color={enableThinking ? 'thinking' : undefined}>
            {enableThinking ? 'ON' : 'OFF'}
          </Text>
        </Box>
      </Box>
    </Dialog>
  )
}

export async function call(
  onDone: (msg: string, opts?: { display?: string }) => void,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode | null> {
  const arg = args?.trim().toLowerCase()
  if (arg === 'on') {
    applyThinking(true)
    onDone('Thinking mode ON — model will think before responding')
    return null
  }
  if (arg === 'off') {
    applyThinking(false)
    onDone('Thinking mode OFF')
    return null
  }

  const currentlyEnabled = isThinkingForced()
  return <ThinkingPicker currentlyEnabled={currentlyEnabled} onDone={onDone} />
}
