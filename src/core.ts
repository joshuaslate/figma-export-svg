import { Api as FigmaApi } from 'figma-api/lib/api-class';
import { Config } from './config';
import {
  cleanOutputDir,
  downloadAndSaveSVGs,
  ensureOutputDir,
  getFigmaFile,
  getFigmaFileSVGDownloadPaths,
  optimizeSVGs,
  validateAndCleanConfig,
} from './shared';

export async function run(config: Config) {
  try {
    config = validateAndCleanConfig(config);

    const api = new FigmaApi({ personalAccessToken: config.accessToken });

    const svgComponents = await getFigmaFile(api, config.fileId, config.nodeIds);

    if (!svgComponents.size) {
      return;
    }

    const svgDownloadPaths = await getFigmaFileSVGDownloadPaths(api, svgComponents, config);

    let svgWrites: string[];

    try {
      // If the clearOutputDirectory flag is set, delete the output directory
      if (config.clearOutputDirectory) {
        await cleanOutputDir(config.outputDirectory);
      }

      // Ensure the output directory exists
      await ensureOutputDir(config.outputDirectory);

      svgWrites = await downloadAndSaveSVGs(svgDownloadPaths, config.outputDirectory, config.fileNameStrategy);
    } catch (err) {
      throw new Error(`Failed to download and save SVGs: ${err}`);
    }

    try {
      await optimizeSVGs(config.svgoConfig, config.svgoConfigPath, svgWrites);
    } catch (err) {
      throw new Error(`Failed to optimize SVGs: ${err}`);
    }
  } catch (err) {
    throw new Error(`[figma-svg-export] error: ${err}`);
  }
}
