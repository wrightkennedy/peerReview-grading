import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function resolveBasePath(): string {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    return '/';
  }

  const repoName = repository.split('/')[1];
  if (!repoName) {
    return '/';
  }

  return `/${repoName}/`;
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? resolveBasePath() : '/',
  build: {
    sourcemap: false,
    target: 'es2022',
  },
}));
