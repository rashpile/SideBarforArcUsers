import { isSystemFolder } from './archiveFolder.ts';

export interface BookmarkTreeNodeLike {
  id: string;
  title?: string;
  url?: string;
  children?: BookmarkTreeNodeLike[];
}

export interface VisibleBookmarkChild<TNode extends BookmarkTreeNodeLike> {
  node: TNode;
  /** Open or marked bookmark surfaced from inside a collapsed folder. */
  isPeek: boolean;
}

export type BookmarkRowClickIntent = 'toggle-folder' | 'select-only' | 'open-bookmark';
export type BookmarkRowKeyIntent =
  | 'toggle-folder'
  | 'expand-folder'
  | 'collapse-folder'
  | 'open-bookmark'
  | 'none';

/**
 * The Space's root bookmark folder only sets the scope and is not a visible row in the sidebar.
 * The Space's archive and Favorites folders are shown only by the Archive section and the
 * Favorites grid.
 */
export const getVisibleSpaceRootItems = <TNode extends BookmarkTreeNodeLike>(
  spaceRoot: TNode,
): TNode[] =>
  (spaceRoot.children ?? []).filter(node => !isSystemFolder(node)) as TNode[];

/**
 * What keeps a bookmark in view under a collapsed folder or the collapsed Bookmarks section:
 * an open page (loaded or active), or a mark for attention, whose point is to keep the item in view.
 */
export const staysVisibleWhenCollapsed = (
  isLoaded: (bookmarkId: string) => boolean,
  isActive: (bookmarkId: string) => boolean,
  isMarked: (bookmarkId: string) => boolean,
): ((bookmarkId: string) => boolean) =>
  (bookmarkId) => isLoaded(bookmarkId) || isActive(bookmarkId) || isMarked(bookmarkId);

/**
 * The open or marked bookmarks among the nodes and everything inside them, in tree order:
 * what a collapsed folder - or the collapsed Bookmarks section -
 * still shows. System folders (archive, Favorites) are skipped, with everything inside them.
 */
export const collectPeekBookmarks = <TNode extends BookmarkTreeNodeLike>(
  nodes: readonly TNode[],
  staysVisible: (bookmarkId: string) => boolean,
): TNode[] =>
{
  const peek: TNode[] = [];

  const visit = (level: readonly BookmarkTreeNodeLike[]) =>
  {
    // Depth-first, to keep the bookmark tree's order
    for (const node of level)
    {
      if (isSystemFolder(node)) continue;

      if (node.url && staysVisible(node.id))
      {
        peek.push(node as TNode);
      }

      if (node.children?.length)
      {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return peek;
};

/**
 * A collapsed folder still shows every open or marked pinned tab below it: the folder stays
 * collapsed, but the user sees which pages are open, which are marked for attention, and which
 * folder holds the current page. The active item is still marked by the row's own active style.
 * System folders (archive, Favorites) are skipped in both modes, with everything inside them.
 */
export const getVisibleBookmarkChildren = <TNode extends BookmarkTreeNodeLike>(
  folder: TNode,
  isExpanded: boolean,
  staysVisible: (bookmarkId: string) => boolean,
): VisibleBookmarkChild<TNode>[] =>
{
  const children = (folder.children ?? []) as TNode[];

  if (isExpanded)
  {
    return children
      .filter((node) => !isSystemFolder(node))
      .map((node) => ({ node, isPeek: false }));
  }

  return collectPeekBookmarks(children, staysVisible).map((node) => ({ node, isPeek: true }));
};

export const resolveBookmarkRowClickIntent = (
  isFolder: boolean,
  hasSelectionModifier: boolean,
): BookmarkRowClickIntent =>
{
  if (hasSelectionModifier)
  {
    return 'select-only';
  }

  return isFolder ? 'toggle-folder' : 'open-bookmark';
};

/**
 * Key handling follows Arc's actions for folders and pinned pages.
 */
export const resolveBookmarkRowKeyIntent = (
  isFolder: boolean,
  isExpanded: boolean,
  key: string,
  hasModifier: boolean,
): BookmarkRowKeyIntent =>
{
  if (hasModifier) return 'none';

  if (key === 'Enter' || key === ' ')
  {
    return isFolder ? 'toggle-folder' : 'open-bookmark';
  }

  if (isFolder && key === 'ArrowRight' && !isExpanded)
  {
    return 'expand-folder';
  }

  if (isFolder && key === 'ArrowLeft' && isExpanded)
  {
    return 'collapse-folder';
  }

  return 'none';
};
