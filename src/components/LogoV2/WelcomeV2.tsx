import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text, useTheme } from 'src/ink.js';
import { env } from '../../utils/env.js';
const WELCOME_V2_WIDTH = 58;

const PUPPY_ART = [
  '          /\\_/\\           ',
  '     ____/ o o \\          ',
  '   /~____  = = /          ',
  '  (______)__m_m)  woof!   ',
];

export function WelcomeV2() {
  const $ = _c(2);
  const [theme] = useTheme();
  let t0;
  if ($[0] !== theme) {
    t0 = (
      <Box width={WELCOME_V2_WIDTH} flexDirection="column">
        <Text><Text color="claude">{"Welcome to Goder Code"} </Text><Text dimColor={true}>v{MACRO.VERSION} </Text></Text>
        <Text dimColor={true}>{"······························································"}</Text>
        {PUPPY_ART.map((line, i) => (
          <Text key={i} color="clawd_body">{line}</Text>
        ))}
      </Box>
    );
    $[0] = theme;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  return t0;
}
