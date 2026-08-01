import { createTheme, rem } from '@mantine/core';

/* Mantine palettes for the OrganLink accent tokens (ui_mastercontext.md Section 2.2).
   Shade index 6 is the exact token value; index 7 is the documented hover value. */
const organlink = [
  '#f1f5f6',
  '#e2ebee',
  '#c6d7dd',
  '#a8c2cb',
  '#8dafba',
  '#7ba1ae',
  '#5b8a9a',
  '#4a7585',
  '#3b5f6d',
  '#2c4954',
];

const success = [
  '#f1f8f3',
  '#e2f0e6',
  '#c4e1cc',
  '#a5d1b1',
  '#8bc49a',
  '#79ba8a',
  '#6ab07b',
  '#559565',
  '#427a50',
  '#30603c',
];

const warning = [
  '#fbf6ee',
  '#f7eddc',
  '#efdab8',
  '#e7c793',
  '#e0b774',
  '#d9ab61',
  '#d4a056',
  '#b78745',
  '#966d36',
  '#755328',
];

const danger = [
  '#faf0f0',
  '#f4e1e1',
  '#e9c3c3',
  '#dea4a4',
  '#d58b8b',
  '#cd7373',
  '#c75c5c',
  '#ab4a4a',
  '#8c3b3b',
  '#6d2c2c',
];

const info = [
  '#f2f5fb',
  '#e5ebf6',
  '#cbd7ed',
  '#b0c3e3',
  '#99b2da',
  '#86a4d2',
  '#7b9acc',
  '#6582b1',
  '#516a92',
  '#3d5173',
];

export const theme = createTheme({
  fontFamily: "'Manrope', sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', monospace",
  fontSizes: {
    xs: rem(11),
    sm: rem(12),
    md: rem(14),
    lg: rem(16),
    xl: rem(18),
  },
  lineHeights: {
    md: '1.5',
  },
  headings: {
    fontFamily: "'Manrope', sans-serif",
    sizes: {
      h1: { fontSize: rem(28), fontWeight: '700' },
      h2: { fontSize: rem(22), fontWeight: '600' },
      h3: { fontSize: rem(18), fontWeight: '600' },
    },
  },
  colors: { organlink, success, warning, danger, info },
  primaryColor: 'organlink',
  primaryShade: 6,
  black: '#2d3436',
  white: '#ffffff',
  /* radius.sm = badge (8px), radius.md = input/button (12px), radius.lg = card (20px) */
  radius: {
    xs: rem(6),
    sm: rem(8),
    md: rem(12),
    lg: rem(20),
    xl: rem(24),
  },
  defaultRadius: 'md',
  components: {
    Badge: { defaultProps: { radius: 'sm' } },
    Button: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { radius: 'lg' } },
    Input: { defaultProps: { radius: 'md' } },
    Modal: { defaultProps: { radius: 'lg' } },
    Paper: { defaultProps: { radius: 'lg' } },
  },
});

export default theme;
