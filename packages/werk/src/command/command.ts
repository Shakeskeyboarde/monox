import { isMainThread } from 'node:worker_threads';

import { type Commander, type CommanderArgs, type CommanderOptions } from '../commander/commander.js';
import { CleanupContext, type CleanupContextOptions } from '../context/cleanup-context.js';
import { Context, type ContextOptions } from '../context/context.js';
import { EachContext, type EachContextOptions } from '../context/each-context.js';
import { InitContext, type InitContextOptions } from '../context/init-context.js';
import { startWorker } from '../utils/start-worker.js';

export interface CommandHooks<A extends CommanderArgs, O extends CommanderOptions, AA extends A = A, OO extends O = O> {
  /**
   * Called when the command is loaded. Intended for configuration of
   * command options, arguments, and help text.
   */
  readonly init?: (context: InitContext) => Commander<A, O>;
  /**
   * Run once before handling individual workspaces.
   */
  readonly before?: (context: Context<AA, OO>) => Promise<void>;
  /**
   * Run once for each workspace.
   */
  readonly each?: (context: EachContext<AA, OO>) => Promise<void>;
  /**
   * Run once after handling individual workspaces.
   */
  readonly after?: (context: Context<AA, OO>) => Promise<void>;
  /**
   * Run once after all other hooks. This is the last chance to perform
   * cleanup, and it must be synchronous.
   */
  readonly cleanup?: (context: CleanupContext<AA, OO>) => void | undefined;
}

export interface CommandType<A extends CommanderArgs, O extends CommanderOptions> {
  readonly init: (options: InitContextOptions) => Commander<any, any>;
  readonly before: (options: Omit<ContextOptions<A, O>, 'startWorker'>) => Promise<void>;
  readonly each: (options: Omit<EachContextOptions<A, O>, 'startWorker'>) => Promise<void>;
  readonly after: (options: Omit<ContextOptions<A, O>, 'startWorker'>) => Promise<void>;
  readonly cleanup: (context: CleanupContextOptions<A, O>) => void;
}

const COMMAND = Symbol('WerkCommand');

export class Command<A extends CommanderArgs, O extends CommanderOptions> implements CommandType<A, O> {
  readonly #init: ((context: InitContext) => Commander<A, O>) | undefined;
  readonly #before: ((context: Context<A, O>) => Promise<void>) | undefined;
  readonly #each: ((context: EachContext<A, O>) => Promise<void>) | undefined;
  readonly #after: ((context: Context<A, O>) => Promise<void>) | undefined;
  readonly #cleanup: ((context: CleanupContext<A, O>) => void) | undefined;

  constructor({ init, before, each, after, cleanup }: CommandHooks<A, O>) {
    Object.assign(this, { [COMMAND]: true });
    this.#init = init;
    this.#before = before;
    this.#each = each;
    this.#after = after;
    this.#cleanup = cleanup;
  }

  readonly init = (options: InitContextOptions): Commander<any, any> => {
    if (!this.#init) return options.commander;

    const context = new InitContext(options);

    try {
      return this.#init(context) as Commander<any, any>;
    } catch (error) {
      context.log.error(error instanceof Error ? error.message : `${error}`);
      process.exitCode = process.exitCode || 1;
    } finally {
      context.destroy();
    }

    return options.commander;
  };

  readonly before = async (options: Omit<ContextOptions<A, O>, 'startWorker'>): Promise<void> => {
    if (!this.#before) return;

    const context = new Context({
      ...options,
      isWorker: !isMainThread,
      workerData: undefined,
      startWorker: (data) => startWorker(options.command.main, { workerData: { stage: 'before', options, data } }),
    });

    await this.#before(context)
      .catch((error) => {
        context.log.error(error instanceof Error ? error.message : `${error}`);
        process.exitCode = process.exitCode || 1;
      })
      .finally(() => context.destroy());
  };

  readonly each = async (options: Omit<EachContextOptions<A, O>, 'startWorker'>): Promise<void> => {
    if (!this.#each) return;

    const context = new EachContext({
      ...options,
      isWorker: !isMainThread,
      workerData: undefined,
      startWorker: (data) => startWorker(options.command.main, { workerData: { stage: 'each', options, data } }),
    });

    await this.#each(context)
      .catch((error) => {
        context.log.error(error instanceof Error ? error.message : `${error}`);
        process.exitCode = process.exitCode || 1;
      })
      .finally(() => context.destroy());
  };

  readonly after = async (options: Omit<ContextOptions<A, O>, 'startWorker'>): Promise<void> => {
    if (!this.#after) return;

    const context = new Context({
      ...options,
      isWorker: !isMainThread,
      workerData: undefined,
      startWorker: (data) => startWorker(options.command.main, { workerData: { stage: 'after', options, data } }),
    });

    await this.#after(context)
      .catch((error) => {
        context.log.error(error instanceof Error ? error.message : `${error}`);
        process.exitCode = process.exitCode || 1;
      })
      .finally(() => context.destroy());
  };

  readonly cleanup = (options: CleanupContextOptions<A, O>): void => {
    if (!this.#cleanup) return;

    const context = new CleanupContext(options);

    try {
      this.#cleanup(context);
    } catch (error) {
      context.log.error(error instanceof Error ? error.message : `${error}`);
      process.exitCode = process.exitCode || 1;
    } finally {
      context.destroy();
    }
  };
}

export const isCommand = (value: unknown): value is Command<any, any> => {
  return (value as any)?.[COMMAND] === true;
};
