import nodeFs from 'node:fs/promises';
import nodePath from 'node:path';

import { JsonAccessor } from '@wurk/json';

import { Npm } from './implementations/npm.js';
import { Pnpm } from './implementations/pnpm.js';
import { Yarn } from './implementations/yarn.js';
import { type PackageManager } from './pm.js';

export const createPackageManager = async (): Promise<PackageManager> => {
  let dir = process.cwd();

  do {
    const pm = await tryCreatePackageManager(dir);
    if (pm) return pm;
  } while (dir !== (dir = nodePath.dirname(dir)));

  throw new Error(`could not determine package manager at "${dir}"`);
};

const tryCreatePackageManager = async (dir: string): Promise<PackageManager | null> => {
  const configFilename = nodePath.resolve(dir, 'package.json');
  const config = await nodeFs.readFile(configFilename, 'utf8')
    .then(JsonAccessor.parse);
  const packageManager = config
    .at('packageManager')
    .as('string');

  // There's a "packageManager" field in the "package.json" file, so this is
  // a root.
  if (packageManager != null) {
    const match = /^[^@]+/u.exec(packageManager);

    // The field value doesn't even loosely match the expected format.
    if (!match) {
      throw new Error(`invalid package manager "${packageManager}" in "${configFilename}"`);
    }

    const [name] = match;

    switch (name) {
      case 'npm':
        return new Npm({ rootDir: dir });
      case 'pnpm':
        return new Pnpm({ rootDir: dir });
      case 'yarn':
        return new Yarn({ rootDir: dir });
      default:
        throw new Error(`unsupported package manager "${name}" in "${configFilename}`);
    }
  }

  // There's a "workspaces" field in the `package.json` file, so this is is
  // a non-PNPM root.
  if (config
    .at('workspaces')
    .exists()) {
    const yarnLockFilename = nodePath.resolve(dir, 'yarn.lock');
    const yarnLockExists = await nodeFs.access(yarnLockFilename)
      .then(() => true, () => false);

    // There's a yarn.lock file so this is a Yarn root.
    if (yarnLockExists != null) {
      return new Yarn({ rootDir: dir });
    }

    // No yarn.lock, so assume NPM (no need to check for package-lock.json)
    return new Npm({ rootDir: dir });
  }
  else {
    const pnpmLockFilename = nodePath.resolve(dir, 'pnpm-lock.yaml');
    const pnpmLockExists = await nodeFs.access(pnpmLockFilename)
      .then(() => true, () => false);

    if (pnpmLockExists) {
      return new Pnpm({ rootDir: dir });
    }
  }

  return null;
};
