import obsidianmd from 'eslint-plugin-obsidianmd-community';

export default [
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
];
