type AsyncStep = () => Promise<unknown>;

/**
 * Pinned tab associations start in a fixed order: the background managers load before the local
 * backup is restored.
 */
export class TabAssociationReadiness
{
  #ready: Promise<boolean>;

  constructor(
    loadManagers: AsyncStep,
    restoreAssociations: AsyncStep,
    onError: (error: unknown) => void = () => {}
  )
  {
    this.#ready = (async () =>
    {
      try
      {
        await loadManagers();
        await restoreAssociations();
        return true;
      }
      catch (error)
      {
        onError(error);
        return false;
      }
    })();
  }

  /**
   * Resolves when initialization ends: true if every step succeeded, false if
   * one failed. Most callers only wait; auto-archive must not act on
   * half-restored state and checks the result.
   */
  wait = (): Promise<boolean> => this.#ready;
}
