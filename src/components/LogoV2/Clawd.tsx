import * as React from 'react';
import { Box, Text } from '../../ink.js';
export type ClawdPose = 'default' | 'arms-up' // both arms raised (used during jump)
| 'look-left' | // both pupils shifted left
'look-right'; // both pupils shifted right

type Props = {
  pose?: ClawdPose;
};

// Capybara logo for Goder Code startup screen.
// Based on the buddy sprite but rendered with fixed eyes.
const POSES: Record<ClawdPose, string[]> = {
  default: [
    '  n______n  ',
    ' ( ●    ● ) ',
    ' (   oo   ) ',
    '  `------´  ',
  ],
  'look-left': [
    '  n______n  ',
    ' (●    ●  ) ',
    ' (   oo   ) ',
    '  `------´  ',
  ],
  'look-right': [
    '  n______n  ',
    ' (  ●    ●) ',
    ' (   oo   ) ',
    '  `------´  ',
  ],
  'arms-up': [
    '    ~  ~    ',
    '  u______n  ',
    ' ( ◕    ◕ ) ',
    ' (   oo   ) ',
    '  `------´  ',
  ],
};
export function Clawd({ pose = 'default' }: Props): React.ReactNode {
  const rows = POSES[pose];
  return (
    <Box flexDirection="column">
      {rows.map((line, i) => (
        <Text key={i} color="clawd_body">{line}</Text>
      ))}
    </Box>
  );
}
