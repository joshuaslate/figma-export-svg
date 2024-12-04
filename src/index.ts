import path from 'node:path';
import { Command } from 'commander';
import { Api as FigmaApi } from 'figma-api';
import ora from 'ora';
import prettyMs from 'pretty-ms';
import { Config } from './config';
import {
  cleanOutputDir,
  downloadAndSaveSVGs,
  ensureOutputDir,
  getFigmaFile,
  getFigmaFileSVGDownloadPaths,
  optimizeSVGs,
  validateAndCleanConfig,
} from './core';

interface CLIContext {
  cwd: string;
  args: string[];
}

export async function cli({ cwd, args }: CLIContext) {
  const start = performance.now();

  const app = new Command();

  await app
    .name('Figma Export SVG')
    // @ts-expect-error - injected at build time from package.json, see build.js
    .version(VERSION)
    .description('A CLI tool for downloading SVGs from Figma, and optionally optimizing them using SVGO')
    // Internal config
    .option('-o, --output-dir <value>', 'The output directory for the downloaded SVG files')
    .option('-c, --clear-output-dir', 'Clear the output directory before writing the SVG files')
    .option(
      '-a, --access-token <value>',
      'A valid Figma Personal Access token https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens#Generate_a_personal_access_token',
    )
    .option(
      '--file-name-strategy <value>',
      'The casing strategy to use for the SVG file names. Options: `camel`, `pascal`, `pascalSnake`, `constant`, `kebab`, `snake`, `train`. Default: `kebab`',
      'kebab',
    )
    .option('-f, --file-id <value>', 'The Figma file ID, e.g., oQ5VCtq1r0KrPx3VpqMSX5')
    .option('-n, --node-id <items>', 'The Figma node ID(s), comma-separated if multiple, e.g., 5432:1234,1234:9876')
    .option('--svgo-config <value>', 'Path to a custom SVGO configuration file')
    // Figma image download options
    .option(
      '--scale <number>',
      'Figma API Image option: Scale - A number between 0.01 and 4, the image scaling factor.',
    )
    .option(
      '--outline-text',
      `Figma API Image option: Outline Text - Whether text elements are rendered as outlines (vector paths) or as <text> elements in SVGs.
Rendering text elements as outlines guarantees that the text looks exactly the same in the SVG as it does in the browser/ inside Figma.
Exporting as <text> allows text to be selectable inside SVGs and generally makes the SVG easier to read. However, this relies on the browser's rendering engine which can vary between browsers and/ or operating systems. As such, visual accuracy is not guaranteed as the result could look different from in Figma.`,
    )
    .option(
      '--include-id',
      'Figma API Image option: Include ID - Whether to include id attributes for all SVG elements. Adds the layer name to the id attribute of an svg element.',
    )
    .option(
      '--include-node-id',
      'Figma API Image option: Include Node ID - Whether to include node id attributes for all SVG elements. Adds the node id to a data-node-id attribute of an svg element.',
    )
    .option(
      '--simplify-stroke',
      'Figma API Image option: Simplify Stroke - Whether to simplify inside/ outside strokes and use stroke attribute if possible instead of <mask>.',
    )
    .option(
      '--contents-only',
      'Figma API Image option: Contents Only - Whether content that overlaps the node should be excluded from rendering. Passing false (i. e., rendering overlaps) may increase processing time, since more of the document must be included in rendering.',
    )
    .option(
      '--absolute-bounds',
      'Figma API Image option: Use Absolute Bounds - Use the full dimensions of the node regardless of whether or not it is cropped or the space around it is empty. Use this to export text nodes without cropping.',
    )
    .parseAsync(args);

  const options = app.opts();

  let config: Config;

  try {
    config = validateAndCleanConfig({
      outputDirectory: path.join(cwd, options.outputDir || 'svg_output'),
      clearOutputDirectory: Boolean(options.clearOutputDir),
      accessToken: options.accessToken,
      fileId: options.fileId,
      nodeIds: options.nodeId ? (Array.isArray(options.nodeId) ? options.nodeId : [options.nodeId]) : [],
      fileNameStrategy: options.fileNameStrategy,
      projectId: options.projectId,
      svgoConfigPath: options.svgoConfig,
      scale: options.scale ? parseFloat(options.scale) : 1,
      outlineText: options.outlineText,
      includeId: options.includeId,
      includeNodeId: options.includeNodeId,
      simplifyStroke: options.simplifyStroke,
      contentsOnly: options.contentsOnly,
      useAbsoluteBounds: options.absoluteBounds,
    });
  } catch (err) {
    console.error(err);

    process.exitCode = 1;
    return;
  }

  const figmaApi = new FigmaApi({ personalAccessToken: config.accessToken });
  let svgComponents: Map<string, string>;

  let spinner = ora(`Loading Figma File: ${config.fileId}`).start();

  try {
    svgComponents = await getFigmaFile(figmaApi, config.fileId, config.nodeIds);
  } catch (err) {
    spinner.fail((err as Error).message);

    process.exitCode = 1;
    return;
  }

  if (!svgComponents.size) {
    spinner.succeed(
      `No SVGs found in the specified Figma file (${config.fileId}). Completed without downloading any SVGs.`,
    );

    process.exitCode = 0;
    return;
  }

  spinner.succeed(`Found ${svgComponents.size} SVGs in Figma file: ${config.fileId}`);

  spinner = ora('Getting image data from Figma').start();

  let svgDownloadPaths: Map<string, string>;

  try {
    svgDownloadPaths = await getFigmaFileSVGDownloadPaths(figmaApi, svgComponents, config);
    spinner.succeed('Image data retrieved from Figma');
  } catch (err) {
    spinner.fail((err as Error).message);

    process.exitCode = 1;
    return;
  }

  try {
    // If the clearOutputDirectory flag is set, delete the output directory
    if (config.clearOutputDirectory) {
      spinner = ora('Clearing output directory').start();

      await cleanOutputDir(config.outputDirectory);
      spinner.succeed('Output directory cleared');
    }

    // Ensure the output directory exists
    await ensureOutputDir(config.outputDirectory);
  } catch (err) {
    console.error(err);

    process.exitCode = 1;
    return;
  }

  let remainingFiles = svgDownloadPaths.size;

  spinner = ora('Downloading SVGs').start();

  spinner.suffixText = `${svgDownloadPaths.size - remainingFiles} / ${svgDownloadPaths.size}`;

  let svgWrites: string[];

  try {
    svgWrites = await downloadAndSaveSVGs(
      svgDownloadPaths,
      config.outputDirectory,
      config.fileNameStrategy,
      (writtenPath) => {
        remainingFiles--;
        spinner.suffixText = `${svgDownloadPaths.size - remainingFiles} / ${svgDownloadPaths.size}`;
        return writtenPath;
      },
    );

    spinner.succeed('All SVGs downloaded');
  } catch (err) {
    spinner.fail((err as Error).message);

    process.exitCode = 1;
    return;
  }

  if (config.svgoConfig || config.svgoConfigPath) {
    spinner = ora('Optimizing SVGs with SVGO').start();

    try {
      await optimizeSVGs(config.svgoConfig, config.svgoConfigPath, svgWrites, cwd);
      spinner.succeed('SVGs optimized with SVGO');
    } catch (err) {
      spinner.fail((err as Error).message);

      process.exitCode = 1;
      return;
    }
  }

  console.log(`SVG Export finished in ${prettyMs(performance.now() - start)}`);
}
