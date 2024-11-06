import type { FileNameStrategy } from './index';

export interface Config {
  // Internal config
  accessToken: string;
  fileId: string;
  nodeIds: string[];
  projectId: string;
  svgoConfigPath: string | undefined;
  outputDirectory: string;
  fileNameStrategy: FileNameStrategy;
  clearOutputDirectory: boolean;

  // Figma image download config
  scale: number | undefined;
  outlineText: boolean | undefined;
  includeId: boolean | undefined;
  includeNodeId: boolean | undefined;
  simplifyStroke: boolean | undefined;
  contentsOnly: boolean | undefined;
  useAbsoluteBounds: boolean | undefined;
}
