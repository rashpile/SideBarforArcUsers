import { pageStyleProxy } from '../managers/proxies/pageStyleProxy';
import { SavedPageStyles } from '../stores/savedPageStyles';

/**
 * The saved page styles as they were before a delete. Background drops a bookmark's style once the
 * bookmark is gone, and Undo creates the bookmark under a new id, so the delete action keeps them
 * and Undo puts each one back on the id it created.
 */
export class PageStyleUndoSnapshot
{
  readonly #styles: SavedPageStyles;

  private constructor(styles: SavedPageStyles)
  {
    this.#styles = styles;
  }

  static empty(): PageStyleUndoSnapshot
  {
    return new PageStyleUndoSnapshot(new SavedPageStyles());
  }

  /** Read before the bookmarks are removed. A failed read keeps nothing; the delete still goes ahead. */
  static async take(context: string): Promise<PageStyleUndoSnapshot>
  {
    try
    {
      return new PageStyleUndoSnapshot(await pageStyleProxy.readStyles());
    }
    catch (err)
    {
      console.error(`${context} saved page styles not read, Undo won't bring them back:`, err);
      return PageStyleUndoSnapshot.empty();
    }
  }

  /** Puts the style the deleted bookmark had onto the bookmark Undo created in its place. */
  async restore(deletedId: string, createdId: string, context: string): Promise<void>
  {
    const style = this.#styles.styleFor(deletedId);
    if (!style) return;
    try
    {
      await pageStyleProxy.restore(createdId, style.toStored());
    }
    catch (err)
    {
      console.error(`${context} saved page style of bookmark ${deletedId} not restored:`, err);
    }
  }
}
