// Runs background tasks one after another. Tab auto-archive and Task Space auto-archive share
// one queue, so they never save into the same Space's asd_Archive at once and create two folders.

export class SerialQueue
{
  #tail: Promise<void> = Promise.resolve();

  /**
   * Run the task after every task queued before it. A failure is logged under the label and
   * doesn't stop the next task; the returned promise never rejects.
   */
  run(label: string, task: () => Promise<void>): Promise<void>
  {
    const result = this.#tail.then(task).catch((error) =>
    {
      console.error(`${label} failed:`, error);
    });
    this.#tail = result;
    return result;
  }
}
