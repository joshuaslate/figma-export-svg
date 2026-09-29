import { readFile, writeFile } from 'node:fs/promises';
import type { SubcanvasNode } from '@figma/rest-api-spec';
import { type Config, optimize } from 'svgo';

const SVG_DOWNLOAD_ATTEMPTS = 3;
const SVG_DOWNLOAD_RETRY_DELAY_MS = 250;

function isConnectionReset(error: unknown): boolean {
  if (error && typeof error === 'object' && 'cause' in error && error.cause && typeof error.cause === 'object' && 'code' in error.cause && error.cause.code === 'ECONNRESET') {
    return true;
  }

  return false;
}

function waitForRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, SVG_DOWNLOAD_RETRY_DELAY_MS * 2 ** attempt);
  });
}

// Collect the SVG components into a map keyed by the node ID, with the value being the SVG name
export function collectSVGComponents(nodes: SubcanvasNode[]): Map<string, string> {
  const discoveredNodes = new Map<string, string>();

  if (!nodes?.length) {
    return discoveredNodes;
  }

  for (const node of nodes) {
    // If it's a component with a vector child, add it to the set
    if (
      node.type === 'COMPONENT' &&
      node.visible !== false &&
      node.exportSettings?.find((setting) => setting.format === 'SVG')
    ) {
      discoveredNodes.set(node.id, node.name);
    } else if ('children' in node && node.children.length) {
      const discoveredChildNodes = collectSVGComponents(node.children);

      for (const [svgId, svgName] of discoveredChildNodes) {
        discoveredNodes.set(svgId, svgName);
      }
    }
  }

  return discoveredNodes;
}

export async function downloadSVG(url: string, filePath: string): Promise<string> {
  let arrayBuffer: ArrayBuffer | undefined;

  for (let attempt = 0; attempt < SVG_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        const body = await response.text();

        throw new Error(`Failed to download SVG from ${url}: ${response.statusText} - ${body}`);
      }

      arrayBuffer = await response.arrayBuffer();
      break;
    } catch (error) {
      const hasRemainingAttempts = attempt < SVG_DOWNLOAD_ATTEMPTS - 1;

      if (!isConnectionReset(error) || !hasRemainingAttempts) {
        throw new Error(`Failed to download SVG from ${url}: ${error}`);
      }

      await waitForRetry(attempt);
    }
  }

  if (!arrayBuffer) {
    throw new Error(`Failed to download SVG from ${url}: no data received after ${SVG_DOWNLOAD_ATTEMPTS} attempts`);
  }

  try {
    await writeFile(filePath, Buffer.from(arrayBuffer));

    return filePath;
  } catch (e) {
    throw new Error(`Failed to write SVG to ${filePath}: ${e}`);
  }
}

export async function optimizeSVG(svgoConfig: Config, svgPath: string) {
  let svgString: string;

  try {
    svgString = await readFile(svgPath, 'utf8');
  } catch (e) {
    throw new Error(`Failed to read SVG from ${svgPath} while attempting optimization: ${e}`);
  }

  if (!svgString) {
    throw new Error(`Encountered empty SVG at ${svgPath} while attempting optimization`);
  }

  try {
    const optimizedSVG = optimize(svgString, svgoConfig);
    await writeFile(svgPath, optimizedSVG.data);
  } catch (e) {
    throw new Error(`Failed to optimize SVG at ${svgPath}: ${e}`);
  }
}
