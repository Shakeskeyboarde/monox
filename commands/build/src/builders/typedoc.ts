import path from 'node:path';

import { type Log } from 'wurk';

import { Builder, type BuilderFactory } from '../builder.js';

export const getTypeDocBuilder: BuilderFactory = async (workspace) => {
  const { fs, spawn } = workspace;

  const filenames = await fs
    .find(['typedoc*.@(js|json)', 'src/typedoc*.@(js|json)'])
    .then((entries) => {
      return entries.map((entry) => {
        return fs.relative(entry.fullpath());
      });
    });

  if (!filenames.length) return null;

  const typedoc = async (
    watch: boolean,
    log: Log,
    filename: string,
  ): Promise<void> => {
    await spawn(
      'typedoc',
      [
        ['--options', path.basename(filename)],
        watch && ['--watch', '--preserveWatchOutput'],
      ],
      { log, output: 'echo', cwd: path.dirname(filename) },
    );
  };

  return new Builder('typedoc', workspace, {
    build: typedoc.bind(null, false),
    start: typedoc.bind(null, true),
    matrix: filenames,
  });
};
