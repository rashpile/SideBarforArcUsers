// The Tab list's Archive button: saves the tabs into the Space's archive,
// then closes them. Closing goes through an action from the
// injected factory (CloseTabAction in the app), which keeps chrome.* out of
// this module so Node tests can load it.

import type { UndoableAction } from './types.ts';
import type { ArchivableTab, TabArchiveBatch, TabArchiveResult } from '../utils/tabArchiveBatch.ts';
import { truncateTitle } from '../utils/truncateTitle.ts';

export type CloseActionFactory = (tabIds: number[]) => UndoableAction;
/** Runs right before the tabs close (the app tells background not to record them as Recently Closed). */
export type BeforeArchiveClose = (tabIds: number[]) => Promise<void>;

export class ArchiveTabsAction implements UndoableAction
{
  description = '';
  #tabs: readonly ArchivableTab[];
  #spaceFolderId: string;
  #batch: TabArchiveBatch;
  #createCloseAction: CloseActionFactory;
  #beforeClose: BeforeArchiveClose;
  #closeAction: UndoableAction | null = null;

  constructor(
    tabs: readonly ArchivableTab[],
    spaceFolderId: string,
    batch: TabArchiveBatch,
    createCloseAction: CloseActionFactory,
    beforeClose: BeforeArchiveClose = async () => {}
  )
  {
    this.#tabs = tabs;
    this.#spaceFolderId = spaceFolderId;
    this.#batch = batch;
    this.#createCloseAction = createCloseAction;
    this.#beforeClose = beforeClose;
  }

  async do(): Promise<void>
  {
    const result = await this.#batch.archive(this.#spaceFolderId, this.#tabs);

    // Close only what was saved (or had nothing to save); a tab whose item failed stays open
    if (result.closableTabIds.length === 0)
    {
      if (result.keptOpenCount > 0) throw new Error('Could not archive tabs');
      this.description = 'No tabs to archive';
      return;
    }

    await this.#beforeClose([...result.closableTabIds]);
    const closeAction = this.#createCloseAction([...result.closableTabIds]);
    this.#closeAction = closeAction;
    await closeAction.do();
    this.description = this.#describe(result);
  }

  async undo(): Promise<void>
  {
    // Reopen first: if that throws, the archive items stay and nothing is lost
    await this.#closeAction?.undo();
    await this.#batch.discard();
  }

  #describe(result: TabArchiveResult): string
  {
    let text: string;
    if (result.archivedCount === 1)
    {
      const tab = this.#tabs.find(t => t.id === result.archivedTabIds[0]);
      text = `Archived "${truncateTitle(tab?.title || tab?.url || '')}"`;
    }
    else if (result.archivedCount > 1)
    {
      text = `Archived ${result.archivedCount} tabs`;
    }
    else
    {
      // Only empty pages: they close without an archive item
      const closed = result.closableTabIds.length;
      text = closed === 1 ? 'Closed 1 empty tab' : `Closed ${closed} empty tabs`;
    }

    if (result.keptOpenCount > 0)
    {
      text += `, ${result.keptOpenCount} kept open`;
    }
    return text;
  }
}
