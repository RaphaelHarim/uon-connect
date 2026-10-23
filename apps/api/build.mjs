// Production bundle of the API and its CLI scripts. npm dependencies stay external
// (installed in the image); the workspace package @uon/shared is bundled from source.
import { build } from 'esbuild';

const externalDeps = {
  name: 'external-deps',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@uon/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: {
    server: 'src/server.ts',
    migrate: 'src/scripts/migrate.ts',
    'seed-base': 'src/scripts/seed-base.ts',
    'seed-demo': 'src/scripts/seed-demo.ts',
    'bootstrap-founder': 'src/scripts/bootstrap-founder.ts',
    'verify-audit': 'src/scripts/verify-audit.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [externalDeps],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
