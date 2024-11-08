import { readFile, writeFile } from 'node:fs/promises';
import type { SubcanvasNode } from '@figma/rest-api-spec';
import { type Config, optimize } from 'svgo';

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
  let response: Response;

  try {
    // Download the SVG
    response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();

      throw new Error(`Failed to download SVG from ${url}: ${response.statusText} - ${body}`);
    }
  } catch (e) {
    throw new Error(`Failed to download SVG from ${url}: ${e}`);
  }

  try {
    const arrayBuffer = await response.arrayBuffer();
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
