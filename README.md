# Figma Export SVG

This is a simple CLI tool to export SVGs from Figma. It uses the Figma API to fetch the SVGs and saves them to the local file system, then optionally optimizes them using SVGO.

## Installation

```bash
npm install -g figma-export-svg
```

## Usage

```bash
figma-export-svg -a <access-token> -f <file-id> -n <node-ids (comma-separated)> -o <output-dir>
```

## Options
```
  -a, --access-token <access-token>  Figma personal access token (https://www.figma.com/developers/api#access-tokens)
  -c, --clear-output-dir             Clear output directory before saving new SVGs
  -o, --output-dir <output-dir>      Output directory
  -f, --file-id <file-id>            Figma file ID, e.g., oQ5VCtq1r0KrPx3VpqMSX5
  -n, --node-ids <node-ids>          Figma node IDs (comma-separated), e.g., 5432:1234,1234:9876
  --file-name-strategy <strategy>    File name strategy: camel, pascal, pascalSnake, constant, kebab, snake, train. Default: kebab
  --svgo-config <value>              Path to SVGO config file (e.g., ./svgo.config.mjs)
  -h, --help                         display help for command
  
  # Figma API options (see: https://www.figma.com/developers/api#get-images-endpoint)
  --scale <value>                    Scale factor for the exported SVGs. Between 0.01 and 4.
  --outline-text                     Convert text to outlines if configured
  --include-id                       Whether to include id attributes for all SVG elements
  --include-node-id                  Whether to include node id attributes for all SVG elements
  --simplify-strokes                 Simplify strokes in the exported SVGs
  --contents-only                    Whether content that overlaps the node should be excluded from rendering
  --absolute-bounds                  Whether to use absolute bounding box for exported SVGs
```
