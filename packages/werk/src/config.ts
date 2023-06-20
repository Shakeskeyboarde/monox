import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getNpmWorkspaces } from './npm/get-npm-workspaces.js';
import { getNpmWorkspacesRoot } from './npm/get-npm-workspaces-root.js';
import { memoize } from './utils/memoize.js';
import { merge } from './utils/merge.js';
import { type PackageJson } from './utils/package-json.js';
import { readJsonFile } from './utils/read-json-file.js';
import { type WorkspaceOptions } from './workspace/workspace.js';

export interface CommandConfig {
  readonly globalArgs: readonly string[];
  readonly args: readonly string[];
  readonly config: unknown;
}

export type Config = {
  readonly version: string;
  readonly description: string;
  readonly rootDir: string;
  readonly workspaces: readonly WorkspaceOptions[];
  readonly commandPackagePrefixes: string[];
  readonly commandPackages: Record<string, string>;
  readonly commandConfigs: Record<string, CommandConfig>;
  readonly globalArgs: readonly string[];
};

export const loadConfig = memoize(async (): Promise<Config> => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const [packageJson, rootDir, workspaces] = await Promise.all([
    await readFile(join(__dirname, '../package.json'), 'utf-8').then((json): PackageJson => JSON.parse(json)),
    await getNpmWorkspacesRoot(),
    await getNpmWorkspaces(),
  ]);
  const { version = '', description = '' } = packageJson;
  const filename = join(rootDir, 'package.json');
  const rootPackageJson = filename ? await readJsonFile<PackageJson>(filename) : {};
  const werk = isObject(rootPackageJson?.werk) ? { ...rootPackageJson.werk } : {};
  const globalArgs = Array.isArray(werk.globalArgs) ? werk.globalArgs.map(String) : [];
  const commandPackagePrefixes = Array.isArray(werk.commandPackagePrefixes)
    ? werk.commandPackagePrefixes.filter((value) => typeof value === 'string')
    : [];
  const commandPackages = isObject(werk.commandPackages)
    ? Object.fromEntries(
        Object.entries(werk.commandPackages).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : {};
  const legacyCommandConfigs = werk.commandConfig;

  delete werk.globalArgs;
  delete werk.commandPackagePrefixes;
  delete werk.commandPackages;
  delete werk.commandConfig;

  const commandConfigs = Object.fromEntries(
    Object.entries(merge(legacyCommandConfigs, werk)).map(([key, value]) => {
      return [
        key,
        {
          globalArgs: isObject(value) && Array.isArray(value?.globalArgs) ? value.globalArgs.map(String) : [],
          args: isObject(value) && Array.isArray(value?.args) ? value.args.map(String) : [],
          config: value,
        },
      ];
    }),
  );

  return {
    version,
    description,
    rootDir,
    workspaces,
    commandPackagePrefixes,
    commandPackages,
    commandConfigs,
    globalArgs,
  };
});

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
