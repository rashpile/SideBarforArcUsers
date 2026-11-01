export interface UndoableAction
{
  description: string;
  do: () => Promise<void>;
  undo: () => Promise<void>;
}

/** Runs a group of bookmark changes as one batch (`runBatchOperation` from `useBookmarks`). */
export type BatchRunner = <T>(fn: () => Promise<T>) => Promise<T>;
