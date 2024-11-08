import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { Command } from 'commander';
import { Api as FigmaApi } from 'figma-api';
import ora from 'ora';
import { camelCase, pascalCase, pascalSnakeCase, constantCase, kebabCase, snakeCase, trainCase } from 'change-case';
import { loadConfig as loadSvgoConfig } from 'svgo';
import prettyMs from 'pretty-ms';
import type { GetFileQueryParams } from '@figma/rest-api-spec';
import { Config } from './config';
import { collectSVGComponents, downloadSVG, optimizeSVG } from './util';

const cases = {
  camel: camelCase,
  pascal: pascalCase,
  pascalSnake: pascalSnakeCase,
  constant: constantCase,
  kebab: kebabCase,
  snake: snakeCase,
  train: trainCase,
} as const;

export type FileNameStrategy = keyof typeof cases;

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

  const config: Config = {
    outputDirectory: path.join(cwd, options.outputDir || 'svg_output'),
    clearOutputDirectory: Boolean(options.clearOutputDir),
    accessToken: options.accessToken,
    fileId: options.fileId,
    nodeIds: (options.nodeId ? (Array.isArray(options.nodeId) ? options.nodeId : [options.nodeId]) : []).reduce(
      (acc, curr) => {
        const cleaned = curr.trim().replace(/-/g, ':');
        if (cleaned) {
          return [...acc, cleaned];
        }

        return acc;
      },
      [] as string[],
    ),
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
  };

  if (!config.outputDirectory) {
    console.error('Missing required parameter: output path (-o /path/to/output)');

    process.exitCode = 1;
    return;
  }

  if (!config.accessToken) {
    console.error('Missing required parameter: Figma personal access token (-a figd_sadasdjl...)');

    process.exitCode = 1;
    return;
  }

  if (!config.fileId) {
    console.error('Missing required parameter: Figma file ID (-f oQ5VCtq1r0KrPx3VpqMSX5)');

    process.exitCode = 1;
    return;
  }

  if (config.scale && (config.scale < 0.01 || config.scale > 4)) {
    console.error('Invalid Figma image scale value, must be between 0.01 and 4');

    process.exitCode = 1;
    return;
  }

  const figmaApi = new FigmaApi({ personalAccessToken: config.accessToken });
  let svgComponents: Map<string, string>;

  let spinner = ora(`Loading Figma File: ${config.fileId}`).start();

  try {
    const queryParams: GetFileQueryParams = config.nodeIds?.length ? { ids: config.nodeIds.join(',') } : {};
    const result = await figmaApi.getFile({ file_key: config.fileId }, queryParams);

    svgComponents = collectSVGComponents(
      result.document.children.flatMap((node) =>
        !config.nodeIds?.length || config.nodeIds.includes(node.id) ? node.children : [],
      ),
    );
  } catch (e) {
    spinner.fail(`Failed to load Figma file: ${config.fileId}. ${e}`);

    process.exitCode = 1;
    return;
  }

  if (!svgComponents.size) {
    spinner.fail('No SVGs found in the specified Figma file');

    process.exitCode = 1;
    return;
  }

  spinner.succeed(`Found ${svgComponents.size} SVGs in Figma file: ${config.fileId}`);

  spinner = ora('Getting image data from Figma').start();

  const svgDownloadPaths = new Map<string, string>();

  try {
    const result = await figmaApi.getImages(
      { file_key: config.fileId },
      {
        ids: Array.from(svgComponents.keys()).join(','),
        format: 'svg',
        scale: config.scale,
        svg_include_id: config.includeId,
        svg_include_node_id: config.includeNodeId,
        svg_simplify_stroke: config.simplifyStroke,
        svg_outline_text: config.outlineText,
        contents_only: config.contentsOnly,
        use_absolute_bounds: config.useAbsoluteBounds,
      },
    );

    if (result.err) {
      throw new Error(result.err);
    }

    for (const [nodeId, url] of Object.entries(result.images)) {
      const svgName = svgComponents.get(nodeId);

      if (!svgName) {
        throw new Error(`No SVG name found for node ${nodeId} returned in get images response. Url: ${url || 'empty'}`);
      }

      if (!url) {
        throw new Error(`No URL found for node ${nodeId} (${svgName}) returned in get images response`);
      }

      svgDownloadPaths.set(svgName, url);
    }

    spinner.succeed('Image data retrieved from Figma');
  } catch (e) {
    spinner.fail(`Failed to get image data from Figma: ${e}`);

    process.exitCode = 1;
    return;
  }

  try {
    // If the clearOutputDirectory flag is set, delete the output directory
    if (config.clearOutputDirectory) {
      spinner = ora('Clearing output directory').start();

      try {
        await rm(config.outputDirectory, { recursive: true, force: true });

        spinner.succeed('Output directory cleared');
      } catch (e) {
        spinner.fail(`Failed to clear output directory: ${e}`);

        process.exitCode = 1;
        return;
      }
    }

    // Ensure the output directory exists
    await mkdir(config.outputDirectory, { recursive: true });
  } catch (e) {
    console.error(`Failed to create output directory: ${e}`);

    process.exitCode = 1;
    return;
  }

  let remainingFiles = svgDownloadPaths.size;

  spinner = ora('Downloading SVGs').start();

  spinner.suffixText = `${svgDownloadPaths.size - remainingFiles} / ${svgDownloadPaths.size}`;

  const caseStrategy = cases[config.fileNameStrategy] || cases.kebab;

  const svgWrites: Promise<string>[] = [];

  for (const [svgName, url] of svgDownloadPaths) {
    const filePath = path.join(config.outputDirectory, `${caseStrategy(svgName)}.svg`);

    svgWrites.push(
      downloadSVG(url, filePath).then((writtenPath) => {
        remainingFiles--;
        spinner.suffixText = `${svgDownloadPaths.size - remainingFiles} / ${svgDownloadPaths.size}`;
        return writtenPath;
      }),
    );
  }

  try {
    await Promise.all(svgWrites);
    spinner.succeed('All SVGs downloaded');
  } catch (e) {
    spinner.fail(`Failed to download SVGs: ${e}`);

    process.exitCode = 1;
    return;
  }

  if (config.svgoConfigPath) {
    spinner = ora('Optimizing SVGs with SVGO').start();

    try {
      let svgoConfig;
      try {
        svgoConfig = await loadSvgoConfig(config.svgoConfigPath, cwd);
      } catch (e) {
        spinner.fail(`Failed to load SVGO configuration file: ${e}`);
        process.exitCode = 1;
        return;
      }

      const optimizePromises: Promise<void>[] = [];

      for (const svgPath of svgWrites) {
        optimizePromises.push(optimizeSVG(svgoConfig, await svgPath));
      }

      await Promise.all(optimizePromises);
      spinner.succeed('SVGs optimized with SVGO');
    } catch (e) {
      spinner.fail(`Failed to optimize SVGs with SVGO: ${e}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`SVG Export finished in ${prettyMs(performance.now() - start)}`);
}
