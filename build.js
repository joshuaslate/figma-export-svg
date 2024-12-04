import esbuild from 'esbuild';
import packageJson from './package.json' with { type: 'json' };

(async function () {
  try {
    const sharedConfig = {
      bundle: true,
      platform: 'node',
      target: 'es2020',
      format: 'cjs',
      define: {
        VERSION: JSON.stringify(packageJson.version),
      },
    };

    await Promise.all([
      // CLI build
      esbuild.build({
        ...sharedConfig,
        entryPoints: ['src/index.ts'],
        outfile: 'dist/index.cjs',
      }),
      // Library/programmatic access build
      esbuild.build({
        ...sharedConfig,
        entryPoints: ['src/core.ts'],
        outfile: 'dist/core.cjs',
      }),
    ]);

    console.log('Build completed successfully');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
