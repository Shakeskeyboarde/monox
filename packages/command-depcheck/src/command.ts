import fs from 'node:fs';

import { createCommand } from '@werk/cli';

import { DependencySet } from './dependency-set.js';
import { getSourceFilenames } from './get-source-filenames.js';

let npmUpdatePromise = Promise.resolve();
let isFailed = false;

export default createCommand({
  config: (commander) => {
    return commander.option('--fix', 'Remove unused dependencies.');
  },
  before: async ({ setPrintSummary }) => {
    setPrintSummary();
  },
  each: async ({ log, workspace, opts, spawn }) => {
    if (!workspace.isSelected) return;

    log.info('Checking dependencies.');
    workspace.setStatus('pending');

    const dependencies = new DependencySet(
      workspace.dir,
      Object.keys({
        ...workspace.dependencies,
        ...workspace.peerDependencies,
        ...workspace.optionalDependencies,
      }),
    );

    if (!dependencies.size) {
      log.info(`No dependencies found.`);
      workspace.setStatus('success', 'no dependencies');
      return;
    }

    const filenames = await getSourceFilenames(workspace.dir);
    const isReact = filenames.some((filename) => /\.(?:jsx|tsx)$/u.test(filename));

    if (isReact) {
      await dependencies.removedUsed('react');
    }

    log.info(`Scanning for imports and requires.`);

    /**
     * Remove all dependencies that appear to be used in a source file.
     *
     * Imports and requires are detected using a regular expression,
     * rather than a full source code parser. This may detect usages that
     * are not real (eg. commented out), but it is fast and good enough.
     *
     * Files are not read in parallel because some systems (Windows) are
     * slow at parallel file access.
     */
    for (const filename of filenames) {
      if (!dependencies.size) {
        // All dependencies have been used.
        break;
      }

      const content = await fs.promises.readFile(filename, 'utf-8');
      const matches = content.matchAll(
        /\b(?:require|import)\(\s*(['"`])((?:@[\w.-]+\/)?[\w.-]+)(?:\1|\/)|(?:\bfrom|^import)\s+(['"`])((?:@[\w.-]+\/)?[\w.-]+)(?:\3|\/)/gmu,
      );

      await Promise.all(
        Array.from(matches)
          .map((match) => (match[2] || match[4])!)
          .map((name) => dependencies.removedUsed(name)),
      );
    }

    if (!dependencies.size) {
      log.info(`All dependencies are used.`);
      workspace.setStatus('success');
      return;
    }

    if (!opts.fix) {
      log.error(`Unused dependencies:`);
      Array.from(dependencies).forEach((dependency) => log.error(`  - ${dependency}`));
      workspace.setStatus('failure');
      isFailed = true;

      return;
    }

    /**
     * Chaining the promise prevents npm update from running in parallel
     * when workspaces are processed in parallel.
     */
    await (npmUpdatePromise = npmUpdatePromise
      .catch(() => {
        // Don't double throw error from other workspaces.
      })
      .then(async () => {
        log.info(`Removing unused dependencies.`);

        await spawn('npm', [!workspace.isRoot && ['-w', workspace.name], 'remove', ...dependencies], {
          errorEcho: true,
          errorReturn: true,
          errorSetExitCode: true,
        });
      }));

    log.info(`All remaining dependencies are used.`);
    workspace.setStatus('success', 'fixed');
  },
  after: async () => {
    /**
     * The exit code is not set in the `each` hook so that processing
     * doesn't stop on the first workspace with a failure. But, it still
     * needs to be set to a non-zero value if any workspace failed.
     */
    if (isFailed) {
      process.exitCode ||= 1;
    }
  },
});
