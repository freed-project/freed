// Offline handoff validation. Run from the repository root.
const root = process.cwd();
const dependencies = process.env.EDITORIAL_TEST_DEPENDENCIES;
if (!dependencies) throw new Error('Set EDITORIAL_TEST_DEPENDENCIES to the isolated node_modules directory.');
export default {
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [
    { find: /^@freed\/shared\/library-core$/, replacement: `${root}/packages/shared/src/library-core/index.ts` },
    { find: /^@freed\/shared$/, replacement: `${root}/packages/shared/src/index.ts` },
    { find: 'react', replacement: `${dependencies}/react` },
    { find: 'zustand', replacement: `${dependencies}/zustand` },
    ...['react-dom', 'date-fns', '@floating-ui/react'].map(find => ({ find, replacement: `${dependencies}/${find}` }))
  ] },
  test: { maxWorkers: 1, fileParallelism: false, include: [
    'packages/ui/src/components/feed/ReaderView.test.tsx', 'packages/shared/src/sample-corpus.test.ts', 'packages/shared/src/sample-youtube.test.ts',
    'packages/pwa/src/lib/sample-data.test.ts', 'packages/pwa/src/lib/demo-checkpoint.test.ts',
    'packages/ui/src/lib/sample-library-seed.test.ts'
  ] }
};
