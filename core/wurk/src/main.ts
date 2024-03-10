import nodeAssert from 'node:assert';
import nodePath from 'node:path';
import nodeUrl from 'node:url';

import { Cli, CliUsageError } from '@wurk/cli';
import { fs } from '@wurk/fs';
import { JsonAccessor } from '@wurk/json';
import { getAnsiColorIterator, log, setLogLevel } from '@wurk/log';
import { createPackageManager } from '@wurk/pm';
import { WorkspaceCollection } from '@wurk/workspace';

import { env } from './env.js';
import { loadCommandPlugins } from './plugin.js';

const mainAsync = async (): Promise<void> => {
  const __dirname = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
  const config = await fs.readJson(nodePath.join(__dirname, '../package.json'));
  const version = config
    .at('version')
    .as('string');
  const description = config
    .at('description')
    .as('string');
  const pm = await createPackageManager();
  const rootConfig = await fs.readJson(pm.rootDir, 'package.json');

  process.chdir(pm.rootDir);
  process.chdir = () => {
    throw new Error('command plugin tried to change the working directory (unsupported)');
  };

  const commandPlugins = await loadCommandPlugins(pm, rootConfig);

  let cli = Cli.create('wurk')
    .description(description)
    .trailer('To get help for a specific command, run `wurk <command> --help`.')
    .version(version)
    .optionHelp()
    .optionVersion()

    // Workspace Options:
    .option('-w, --workspace <expression>', {
      description:
        'select workspaces by name, keyword, directory, or private value',
      key: 'expressions',
      group: 'Workspace Options',
      parse: (
        value,
        previous: [string, ...string[]] | undefined,
      ): [string, ...string[]] => [...(previous ?? []), value],
    })
    .option('--include-root-workspace', {
      description: 'include the root workspace',
      group: 'Workspace Options',
    })

    // Parallelization Options:
    .option('--parallel', {
      description:
        'process all workspaces simultaneously without topological awaiting',
      group: 'Parallelization Options',
    })
    .option('--stream', {
      description: 'process workspaces concurrently with topological awaiting',
      group: 'Parallelization Options',
    })
    .option('--concurrency <count>', {
      description: 'maximum number of simultaneous streaming workspaces',
      group: 'Parallelization Options',
      parse: (value) => {
        const count = Number(value);
        nodeAssert(Number.isInteger(count), 'concurrency must be an integer');
        nodeAssert(count > 0, 'concurrency must be a non-zero positive number');
        return count;
      },
    })
    .optionAction('concurrency', ({ result }) => {
      result.options.stream = true;
    })

    // Logging Options:
    .option('--loglevel <level>', {
      description:
        'set the log level. (silent, error, warn, notice, info, verbose, silly)',
      group: 'Logging Options',
      key: null,
      parse: setLogLevel,
    })

    // Command Fallback:
    .setCommandOptional()
    .setUnknownNamedOptionAllowed()
    .option('[script]', 'run a root package script')
    .option('[script-args...]', 'arguments for the script')

    .action(async ({ options, command }) => {
      const {
        expressions = JsonAccessor.parse(env.WURK_WORKSPACE_EXPRESSIONS)
          .as('array', [] as unknown[])
          .filter((value): value is string => typeof value === 'string'),
        includeRootWorkspace = JsonAccessor.parse(env.WURK_INCLUDE_ROOT_WORKSPACE)
          .as('boolean', false),
        parallel = JsonAccessor.parse(env.WURK_PARALLEL)
          .as('boolean', false),
        stream = JsonAccessor.parse(env.WURK_STREAM)
          .as('boolean', false),
        concurrency = JsonAccessor.parse(env.WURK_CONCURRENCY)
          .as('number'),
        script,
        scriptArgs,
      } = options;
      const running = env.WURK_RUNNING_COMMANDS?.split(/\s*,\s*/u) ?? [];
      const commandName = Object.keys(command)
        .at(0)!;

      if (running.includes(commandName)) {
        // Block commands from recursively calling themselves, even indirectly.
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(0);
      }

      env.WURK_RUNNING_COMMANDS = [...running, commandName].join(',');

      const workspaceDirs = await pm.getWorkspaces();
      const workspaceEntries = await Promise.all(workspaceDirs.map(async (workspaceDir) => {
        const workspaceConfig = await fs.readJson(
          workspaceDir,
          'package.json',
        );

        if (!workspaceConfig.at('name')) {
          throw new Error(`workspace at "${workspaceDir}" has no name`);
        }

        return [workspaceDir, workspaceConfig] as const;
      }));
      const workspaces = new WorkspaceCollection({
        root: rootConfig,
        rootDir: pm.rootDir,
        workspaces: workspaceEntries,
        includeRootWorkspace,
        concurrency,
        defaultIterationMethod: parallel
          ? 'forEachParallel'
          : stream
            ? 'forEachStream'
            : 'forEachSequential',
      });
      const allWorkspaces = new Set([...workspaces.all, workspaces.root]);
      const colors = getAnsiColorIterator({
        loop: true,
        count: allWorkspaces.size,
      });

      allWorkspaces.forEach((workspace) => {
        workspace.log.prefix = workspace.name;
        workspace.log.prefixStyle = colors.next().value;
      });

      workspaces.select(expressions.length ? expressions : '**');
      commandPlugins.forEach((commandPlugin) => commandPlugin.init(workspaces));

      env.WURK_WORKSPACE_EXPRESSIONS = JSON.stringify(expressions);
      env.WURK_INCLUDE_ROOT_WORKSPACE = JSON.stringify(includeRootWorkspace);
      env.WURK_PARALLEL = JSON.stringify(parallel);
      env.WURK_STREAM = JSON.stringify(stream);
      env.WURK_CONCURRENCY = JSON.stringify(concurrency);

      if (script) {
        if (
          workspaces.root.config
            .at('scripts')
            .at(script)
            .as('string') == null
        ) {
          throw new Error(`"${script}" is not a command or root package script`);
        }

        await pm.spawnPackageScript(script, scriptArgs, { output: 'inherit' });
      }
    });

  for (const commandPlugin of commandPlugins) {
    cli = cli.command(commandPlugin.cli);
  }

  await cli
    .setExitOnError(false)
    .parse()
    .catch((error: unknown) => {
      process.exitCode ||= 1;

      if (error instanceof CliUsageError) {
        cli.printHelp(error);
      }
      else {
        log.error({ message: error });
      }
    });
};

await mainAsync();
