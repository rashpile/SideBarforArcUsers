import React from 'react';
import * as ContextMenu from './menu/ContextMenu';
import { Pencil, X, Trash2, FolderPlus, Copy, ClipboardPaste } from 'lucide-react';

interface SpaceContextMenuContentProps
{
  onEdit?: () => void;
  onDelete?: () => void;
  onCloseAllTabs?: () => void;
  onCreateFolder?: () => void;  // shown only when provided (space has a resolvable root folder)
  onCopyAsYaml?: () => void;  // same condition as onCreateFolder
  onPasteFromYaml?: () => void;  // same condition as onCreateFolder
  canDelete?: boolean;
}

export const SpaceContextMenuContent: React.FC<SpaceContextMenuContentProps> = ({
  onEdit,
  onDelete,
  onCloseAllTabs,
  onCreateFolder,
  onCopyAsYaml,
  onPasteFromYaml,
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

      {(onCopyAsYaml || onPasteFromYaml) && (
        <>
          <ContextMenu.Separator />
          {onCopyAsYaml && (
            <ContextMenu.Item onSelect={onCopyAsYaml}>
              <Copy size={14} className="mr-2 flex-shrink-0" /> Copy Space as YAML
            </ContextMenu.Item>
          )}
          {onPasteFromYaml && (
            <ContextMenu.Item onSelect={onPasteFromYaml}>
              <ClipboardPaste size={14} className="mr-2 flex-shrink-0" /> Paste from YAML...
            </ContextMenu.Item>
          )}
        </>
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
