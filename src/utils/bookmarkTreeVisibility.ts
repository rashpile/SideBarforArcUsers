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
 * Space 绑定的书签根文件夹只负责界定范围，不作为侧边栏中的可见行。
 * The Space's archive folder (feature 035) is shown only by the Archive section.
 */
export const getVisibleSpaceRootItems = <TNode extends BookmarkTreeNodeLike>(
  spaceRoot: TNode,
): TNode[] =>
  (spaceRoot.children ?? []).filter(node => !isArchiveFolder(node)) as TNode[];

/**
 * The open bookmarks among the nodes and everything inside them, in tree order:
 * what a collapsed folder - or the collapsed Bookmarks section (feature 035) -
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
    // 深度优先遍历保持书签树原有顺序
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
 * 返回文件夹当前应渲染的子节点。
 *
 * 折叠时仍递归寻找所有已打开的固定 Tab：文件夹结构保持折叠，但用户能看到
 * 哪些页面开着、当前页面位于哪个文件夹。活跃项依旧由行本身的 active 样式标出。
 * Archive folders (feature 035) are skipped in both modes, with everything inside them.
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

/**
 * 将文件夹行点击与书签打开区分开，组合键点击继续交给多选逻辑处理。
 */
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
 * 将键盘输入解析为与 Arc 一致的文件夹和固定页面动作。
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
