const esbuild = require('esbuild');

(async function () {
  try {
    await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      platform: 'node',
      outfile: 'dist/index.js',
      target: 'es2020',
      define: {
        VERSION: JSON.stringify(require('./package.json').version),
      },
    });

    console.log('Build completed successfully');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
