import { isArchiveFolder } from './archiveFolder.ts';

export interface BookmarkTreeNodeLike {
  id: string;
  title?: string;
  url?: string;
  children?: BookmarkTreeNodeLike[];
}

export interface VisibleBookmarkChild<TNode extends BookmarkTreeNodeLike> {
  node: TNode;
  /** Open bookmark surfaced from inside a collapsed folder. */
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
 * The Space's archive folder is shown only by the Archive section.
 */
export const getVisibleSpaceRootItems = <TNode extends BookmarkTreeNodeLike>(
  spaceRoot: TNode,
): TNode[] =>
  (spaceRoot.children ?? []).filter(node => !isArchiveFolder(node)) as TNode[];

/**
 * The open bookmarks among the nodes and everything inside them, in tree order:
 * what a collapsed folder - or the collapsed Bookmarks section -
 * still shows. Archive folders are skipped, with everything inside them.
 */
export const collectOpenBookmarks = <TNode extends BookmarkTreeNodeLike>(
  nodes: readonly TNode[],
  isOpen: (bookmarkId: string) => boolean,
): TNode[] =>
{
  const open: TNode[] = [];

  const visit = (level: readonly BookmarkTreeNodeLike[]) =>
  {
    // Depth-first, to keep the bookmark tree's order
    for (const node of level)
    {
      if (isArchiveFolder(node)) continue;

      if (node.url && isOpen(node.id))
      {
        open.push(node as TNode);
      }

      if (node.children?.length)
      {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return open;
};

/**
 * A collapsed folder still shows every open pinned tab below it: the folder stays collapsed, but
 * the user sees which pages are open and which folder holds the current page. The active item is
 * still marked by the row's own active style.
 * Archive folders are skipped in both modes, with everything inside them.
 */
export const getVisibleBookmarkChildren = <TNode extends BookmarkTreeNodeLike>(
  folder: TNode,
  isExpanded: boolean,
  isOpen: (bookmarkId: string) => boolean,
): VisibleBookmarkChild<TNode>[] =>
{
  const children = (folder.children ?? []) as TNode[];

  if (isExpanded)
  {
    return children
      .filter((node) => !isArchiveFolder(node))
      .map((node) => ({ node, isPeek: false }));
  }

  return collectOpenBookmarks(children, isOpen).map((node) => ({ node, isPeek: true }));
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
