import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { camelCase, constantCase, kebabCase, pascalCase, pascalSnakeCase, snakeCase, trainCase } from 'change-case';
import { loadConfig as loadSvgoConfig } from 'svgo';
import { Api as FigmaApi } from 'figma-api/lib/api-class';
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

function cleanNodeIds(nodeIds: string[]) {
  return nodeIds.reduce((acc, curr) => {
    const cleaned = curr.trim().replace(/-/g, ':');

    if (cleaned) {
      return [...acc, cleaned];
    }

    return acc;
  }, [] as string[]);
}

export function validateAndCleanConfig(config: Config): Config {
  if (config.nodeIds) {
    config.nodeIds = cleanNodeIds(config.nodeIds);
  }

  if (!config.outputDirectory) {
    throw new Error('Missing required parameter: output path (-o /path/to/output)');
  }

  if (!config.accessToken) {
    throw new Error('Missing required parameter: Figma personal access token (-a figd_sadasdjl...)');
  }

  if (!config.fileId) {
    throw new Error('Missing required parameter: Figma file ID (-f oQ5VCtq1r0KrPx3VpqMSX5)');
  }

  if (config.scale && (config.scale < 0.01 || config.scale > 4)) {
    throw new Error('Invalid Figma image scale value, must be between 0.01 and 4');
  }

  return config;
}

export async function getFigmaFile(api: FigmaApi, fileId: string, nodeIds: string[] = []) {
  let svgComponents: Map<string, string>;

  try {
    const queryParams: GetFileQueryParams = nodeIds.length ? { ids: nodeIds.join(',') } : {};
    const result = await api.getFile({ file_key: fileId }, queryParams);

    svgComponents = collectSVGComponents(
      result.document.children.flatMap((node) => (!nodeIds.length || nodeIds.includes(node.id) ? node.children : [])),
    );
  } catch (e) {
    throw new Error(`Failed to load Figma file: ${fileId}. ${e}`);
  }

  return svgComponents;
}

function getFigmaFileRequestBatches(svgComponents: Map<string, string>, batchSize: number = 300) {
  const batches: string[][] = [];

  const imageIds = Array.from(svgComponents.keys());

  for (let i = 0; i < imageIds.length; i += batchSize) {
    batches.push(imageIds.slice(i, i + batchSize));
  }

  return batches;
}

async function getFigmaFileBatchImages(api: FigmaApi, config: Config, batch: string[]) {
  const result = await api.getImages(
    { file_key: config.fileId },
    {
      ids: batch.join(','),
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
    throw new Error(`Figma getImages error: ${result.err}`);
  }

  return result.images;
}

export async function getFigmaFileSVGDownloadPaths(api: FigmaApi, svgComponents: Map<string, string>, config: Config) {
  const svgDownloadPaths = new Map<string, string>();
  const idBatches = getFigmaFileRequestBatches(svgComponents);

  try {
    const results = await Promise.all(idBatches.map((ids) => getFigmaFileBatchImages(api, config, ids)));

    for (const result of results) {
      for (const [nodeId, url] of Object.entries(result)) {
        const svgName = svgComponents.get(nodeId);

        if (!svgName) {
          throw new Error(
            `No SVG name found for node ${nodeId} returned in get images response. Url: ${url || 'empty'}`,
          );
        }

        if (!url) {
          throw new Error(`No URL found for node ${nodeId} (${svgName}) returned in get images response`);
        }

        svgDownloadPaths.set(svgName, url);
      }
    }
  } catch (e) {
    throw new Error(`Failed to get image data from Figma: ${e}`);
  }

  return svgDownloadPaths;
}

export async function optimizeSVGs(
  svgoConfig: Config['svgoConfig'],
  svgoConfigPath: Config['svgoConfigPath'],
  svgWrites: string[],
  cwd?: string,
) {
  if (!svgoConfig && !svgoConfigPath) {
    throw new Error('No SVGO configuration found');
  }

  try {
    let resolvedSVGOConfig;

    try {
      resolvedSVGOConfig =
        svgoConfig || svgoConfigPath ? await loadSvgoConfig(svgoConfigPath as string, cwd) : undefined;

      if (!resolvedSVGOConfig) {
        throw new Error('No SVGO configuration found');
      }
    } catch (e) {
      throw new Error(`Failed to load SVGO configuration file: ${e}`);
    }

    const optimizePromises: Promise<void>[] = [];

    for (const svgPath of svgWrites) {
      optimizePromises.push(optimizeSVG(resolvedSVGOConfig, svgPath));
    }

    await Promise.all(optimizePromises);
  } catch (e) {
    throw new Error(`Failed to optimize SVGs with SVGO: ${e}`);
  }
}

export async function downloadAndSaveSVGs(
  svgDownloadPaths: Map<string, string>,
  outputDir: string,
  namingStrategy: FileNameStrategy = 'kebab',
  onDownload?: (downloadPath: string) => string,
): Promise<string[]> {
  const caseStrategy = cases[namingStrategy];

  const svgWrites: Promise<string>[] = [];

  for (const [svgName, url] of svgDownloadPaths) {
    const filePath = path.join(outputDir, `${caseStrategy(svgName)}.svg`);

    svgWrites.push(downloadSVG(url, filePath).then(onDownload));
  }

  try {
    return Promise.all(svgWrites);
  } catch (err) {
    throw new Error(`Failed to download SVGs: ${err}`);
  }
}

export async function ensureOutputDir(outputDir: string) {
  try {
    // Ensure the output directory exists
    await mkdir(outputDir, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to create output directory: ${err}`);
  }
}

export async function cleanOutputDir(outputDir: string) {
  try {
    await rm(outputDir, { recursive: true, force: true });
  } catch (err) {
    throw new Error(`Failed to clear output directory: ${err}`);
  }
}
