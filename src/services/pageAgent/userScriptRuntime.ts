// The runtime of the page agent's scripts, run in the extension's USER_SCRIPT world of the page.
//
// The runner sends runUserScriptCommand to chrome.userScripts.execute as source text (toString()), so it
// must stay self-contained: no imports, no module-level constants or helpers, only its arguments and
// nested functions. Types are fine: they are erased. Node tests call it directly, so nothing here may
// touch the DOM or chrome.* at import time.
//
// The agent's code is compiled here with new Function instead of being passed to execute() as it is:
// execute() returns null for code that throws or doesn't parse, with no error, so only a wrapper can tell
// the model what went wrong. The world's CSP allows 'unsafe-eval'; only the agent's code runs there.

export type UserScriptCommand =
  | { kind: 'apply'; code: string }
  | { kind: 'check'; code: string }
  | { kind: 'undo' };

/**
 * `value` is the JSON text of what the code returned, capped; `errors` are errors thrown since the last
 * command by listeners and timers the script registered through `agent`.
 */
export type UserScriptResult =
  | { ok: true; compiled: true; value: string; errors: string[] }
  | { ok: false; compiled: boolean; error: string; errors: string[] };

export interface UserScriptLimits
{
  /** Characters of the returned value's JSON text kept. */
  maxValueChars: number;
  /** Most errors kept between two commands. */
  maxErrors: number;
  /** How long a command waits for the code's promise. */
  timeoutMs: number;
}

/** What one script registered through `agent`, undone in reverse order. */
interface ScriptRegistry
{
  cleanups: Array<() => void>;
  /** Undone already: whatever the script's code still registers is undone at once. */
  retired: boolean;
}

/** Kept in the world's global, so it outlives one execute() call. */
interface PageAgentWorldState
{
  registry: ScriptRegistry;
  errors: string[];
}

type CodeOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Injected into the USER_SCRIPT world. `apply` undoes the running script and runs the new one, `check`
 * runs code whose registrations are undone as soon as it returns, `undo` undoes the running script.
 * Code that doesn't compile changes nothing.
 */
export async function runUserScriptCommand(command: UserScriptCommand, limits: UserScriptLimits): Promise<UserScriptResult>
{
  const holder = globalThis as unknown as { __sidebarPageAgent?: PageAgentWorldState };
  if (!holder.__sidebarPageAgent)
  {
    holder.__sidebarPageAgent = { registry: { cleanups: [], retired: false }, errors: [] };
  }
  const state = holder.__sidebarPageAgent;

  function errorText(error: unknown): string
  {
    try
    {
      if (error && typeof error === 'object' && 'message' in error)
      {
        const { name, message } = error as { name?: unknown; message?: unknown };
        return `${typeof name === 'string' && name ? name : 'Error'}: ${String(message)}`;
      }
      return String(error);
    }
    catch
    {
      return 'an error that cannot be shown as text';
    }
  }

  function recordError(error: unknown): void
  {
    if (state.errors.length < limits.maxErrors)
    {
      state.errors.push(errorText(error));
    }
  }

  function takeErrors(): string[]
  {
    const errors = state.errors;
    state.errors = [];
    return errors;
  }

  function runCleanup(cleanup: () => void): void
  {
    try
    {
      cleanup();
    }
    catch (error)
    {
      recordError(error);
    }
  }

  function register(registry: ScriptRegistry, cleanup: () => void): void
  {
    // A script that timed out keeps running; what it registers after Undo or the next apply must not stay.
    if (registry.retired)
    {
      runCleanup(cleanup);
      return;
    }
    registry.cleanups.push(cleanup);
  }

  function unregister(registry: ScriptRegistry, cleanup: () => void): void
  {
    const index = registry.cleanups.indexOf(cleanup);
    if (index >= 0)
    {
      registry.cleanups.splice(index, 1);
    }
  }

  function retire(registry: ScriptRegistry): void
  {
    registry.retired = true;
    const cleanups = registry.cleanups;
    registry.cleanups = [];
    for (let index = cleanups.length - 1; index >= 0; index--)
    {
      runCleanup(cleanups[index]);
    }
  }

  // A callback that throws would otherwise end up in the page's console, where the model never sees it.
  function guard<A extends unknown[]>(callback: (...args: A) => unknown): (...args: A) => void
  {
    return function (this: unknown, ...args: A): void
    {
      try
      {
        const result = callback.apply(this, args);
        if (result && typeof (result as Promise<unknown>).then === 'function')
        {
          (result as Promise<unknown>).then(undefined, recordError);
        }
      }
      catch (error)
      {
        recordError(error);
      }
    };
  }

  function createAgent(registry: ScriptRegistry)
  {
    return {
      on(target: EventTarget, type: string, listener: (event: Event) => unknown, options?: boolean | AddEventListenerOptions): void
      {
        const guarded = guard(listener);
        target.addEventListener(type, guarded, options);
        register(registry, () => target.removeEventListener(type, guarded, options));
      },
      setInterval(callback: () => unknown, ms: number): ReturnType<typeof setInterval>
      {
        const id = setInterval(guard(callback), ms);
        register(registry, () => clearInterval(id));
        return id;
      },
      setTimeout(callback: () => unknown, ms: number): ReturnType<typeof setTimeout>
      {
        const guarded = guard(callback);
        const cleanup = (): void => clearTimeout(id);
        // A fired timeout has nothing left to undo; dropping it keeps a polling script from growing the registry.
        const id = setTimeout(() =>
        {
          unregister(registry, cleanup);
          guarded();
        }, ms);
        register(registry, cleanup);
        return id;
      },
      observe(target: Node, options: MutationObserverInit, callback: MutationCallback): MutationObserver
      {
        const observer = new MutationObserver(guard(callback));
        observer.observe(target, options);
        register(registry, () => observer.disconnect());
        return observer;
      },
      add<T extends ChildNode>(node: T): T
      {
        register(registry, () => node.remove());
        return node;
      },
      onUndo(callback: () => void): void
      {
        register(registry, callback);
      },
    };
  }

  function compile(code: string): ((agent: unknown) => Promise<unknown>) | { error: string }
  {
    try
    {
      return new Function('agent', '"use strict";\nreturn (async () => {\n' + code + '\n})();') as (agent: unknown) => Promise<unknown>;
    }
    catch (error)
    {
      return { error: errorText(error) };
    }
  }

  async function runCode(compiled: (agent: unknown) => Promise<unknown>, registry: ScriptRegistry, timeoutError: string): Promise<CodeOutcome>
  {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CodeOutcome>(resolve =>
    {
      timer = setTimeout(() => resolve({ ok: false, error: timeoutError }), limits.timeoutMs);
    });
    try
    {
      const running = Promise.resolve(compiled(createAgent(registry))).then(
        (value): CodeOutcome => ({ ok: true, value }),
        (error): CodeOutcome => ({ ok: false, error: errorText(error) }),
      );
      return await Promise.race([running, timeout]);
    }
    catch (error)
    {
      return { ok: false, error: errorText(error) };
    }
    finally
    {
      clearTimeout(timer);
    }
  }

  function serialize(value: unknown): string
  {
    let text: string;
    try
    {
      // JSON.stringify gives undefined for undefined, functions and symbols.
      text = JSON.stringify(value) ?? String(value);
    }
    catch
    {
      try
      {
        text = String(value);
      }
      catch
      {
        text = '(a value that cannot be shown as text)';
      }
    }
    if (text.length > limits.maxValueChars)
    {
      text = `${text.slice(0, limits.maxValueChars)}… (cut at ${limits.maxValueChars} characters)`;
    }
    return text;
  }

  function result(outcome: CodeOutcome): UserScriptResult
  {
    return outcome.ok
      ? { ok: true, compiled: true, value: serialize(outcome.value), errors: takeErrors() }
      : { ok: false, compiled: true, error: outcome.error, errors: takeErrors() };
  }

  const seconds = `${limits.timeoutMs / 1000} s`;

  if (command.kind === 'undo')
  {
    retire(state.registry);
    state.registry = { cleanups: [], retired: false };
    return { ok: true, compiled: true, value: 'null', errors: takeErrors() };
  }

  const compiled = compile(command.code);
  if (typeof compiled !== 'function')
  {
    return { ok: false, compiled: false, error: compiled.error, errors: takeErrors() };
  }

  if (command.kind === 'check')
  {
    const registry: ScriptRegistry = { cleanups: [], retired: false };
    const outcome = await runCode(compiled, registry, `still running after ${seconds}; what it registered was removed`);
    // A check only measures: whatever it registered goes as soon as it returns.
    retire(registry);
    return result(outcome);
  }

  retire(state.registry);
  const registry: ScriptRegistry = { cleanups: [], retired: false };
  state.registry = registry;
  // A failed or timed-out script keeps what it registered, so Undo still removes it.
  return result(await runCode(compiled, registry, `still running after ${seconds}; what it registered stays, Undo removes it`));
}
