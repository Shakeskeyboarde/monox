import { type PartialCli } from './cli.js';
import { type UnknownResult } from './result.js';

type RunCli = PartialCli<
  'name' | 'actions' | 'commands' | 'getHelpText' | 'printHelp'
>;

type CleanupAction = (result: UnknownResult) => void | Promise<void>;

const run = async (cli: RunCli, result: UnknownResult): Promise<void> => {
  const cleanupActions: CleanupAction[] = [];

  for (const action of cli.actions) {
    const cleanupAction = await action(result);

    if (cleanupAction) {
      cleanupActions.unshift(cleanupAction);
    }
  }

  // There should only be one entry in the commands dictionary, but handle
  // all of them just in case.
  for (const [commandName, commandResult] of Object.entries(result.command)) {
    if (!commandResult) continue;

    const command = cli.commands.find((value) => value.name === commandName)!;

    await run(command, commandResult);
  }

  for (const callback of cleanupActions) {
    await callback(result);
  }
};

export { run };
