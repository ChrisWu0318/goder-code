import * as React from 'react';
import { Box, Text } from '../../ink.js';
export type ClawdPose = 'default' | 'arms-up' // both arms raised (used during jump)
| 'look-left' | // both pupils shifted left
'look-right'; // both pupils shifted right

type Props = {
  pose?: ClawdPose;
};

// Cute West Highland White Terrier (Westie) ASCII art!
// 4 rows: fluffy head, ears+eyes, nose+mouth, fluffy chin
type WestiePose = {
  rows: string[];
};

const POSES: Record<ClawdPose, WestiePose> = {
  default: {
    rows: [
      ' ╭━╮   ╭━╮ ',
      ' ┃▕ ╰─╯ ▏┃ ',
      ' ╰┃ ●▽● ┃╯ ',
      '   ╰─∪─╯   ',
    ],
  },
  'look-left': {
    rows: [
      ' ╭━╮   ╭━╮ ',
      ' ┃▕ ╰─╯ ▏┃ ',
      ' ╰┃●  ▽●┃╯ ',
      '   ╰─∪─╯   ',
    ],
  },
  'look-right': {
    rows: [
      ' ╭━╮   ╭━╮ ',
      ' ┃▕ ╰─╯ ▏┃ ',
      ' ╰┃ ●▽ ●┃╯ ',
      '   ╰─∪─╯   ',
    ],
  },
  'arms-up': {
    rows: [
      ' ╭━╮   ╭━╮ ',
      ' ┃▕ ╰─╯ ▏┃ ',
      ' ╰┃ ◕▽◕ ┃╯ ',
      '   ╰─∪─╯   ',
    ],
  },
};
export function Clawd({ pose = 'default' }: Props): React.ReactNode {
  const p = POSES[pose];
  return (
    <Box flexDirection="column">
      {p.rows.map((line, i) => (
        <Text key={i} color="clawd_body">{line}</Text>
      ))}
    </Box>
  );
}
