import nkzw from '@nkzw/eslint-config';

export default [
  ...nkzw,
  { ignores: ['lib/**/*'] },
  {
    files: ['src/**/*'],
    rules: {
      'no-console': 0,
    },
  },
];
