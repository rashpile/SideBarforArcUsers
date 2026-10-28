import React from 'react';
import * as ContextMenu from './menu/ContextMenu';
import { Pencil, X, Trash2, FolderPlus } from 'lucide-react';

interface SpaceContextMenuContentProps
{
  onEdit?: () => void;
  onDelete?: () => void;
  onCloseAllTabs?: () => void;
  onCreateFolder?: () => void;  // shown only when provided (space has a resolvable root folder)
  canDelete?: boolean;
}

export const SpaceContextMenuContent: React.FC<SpaceContextMenuContentProps> = ({
  onEdit,
  onDelete,
  onCloseAllTabs,
  onCreateFolder,
  canDelete = true,
}) =>
{
  return (
    <>
      <ContextMenu.Item onSelect={onEdit}>
        <Pencil size={14} className="mr-2 flex-shrink-0" /> Edit
      </ContextMenu.Item>

      {onCreateFolder && (
        <ContextMenu.Item onSelect={onCreateFolder}>
          <FolderPlus size={14} className="mr-2 flex-shrink-0" /> New Folder
        </ContextMenu.Item>
      )}

      <ContextMenu.Separator />

      <ContextMenu.Item onSelect={onCloseAllTabs}>
        <X size={14} className="mr-2 flex-shrink-0" /> Close All Tabs In Space
      </ContextMenu.Item>

      {canDelete && (
        <>
          <ContextMenu.Separator />
          <ContextMenu.Item danger onSelect={onDelete}>
            <Trash2 size={14} className="mr-2 flex-shrink-0" /> Delete
          </ContextMenu.Item>
        </>
      )}
    </>
  );
};
