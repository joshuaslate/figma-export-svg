import esbuild from 'esbuild';
import packageJson from './package.json' with { type: 'json' };

(async function () {
  try {
    await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      platform: 'node',
      outfile: 'dist/index.cjs',
      target: 'es2020',
      format: 'cjs',
      define: {
        VERSION: JSON.stringify(packageJson.version),
      },
    });

    console.log('Build completed successfully');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
