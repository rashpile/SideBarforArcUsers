import React, { Suspense } from 'react';
import { SpaceDeleteDialog } from './SpaceDeleteDialog';
import { Space, useSpacesContext } from '../contexts/SpacesContext';
import { UndoableAction } from '../actions/types';
import { DeleteSpaceAction } from '../actions/deleteSpaceAction';
import { useBookmarkTabsContext } from '../contexts/BookmarkTabsContext';
import { resolveSpaceIdAfterDeletion } from '../utils/spaceSelection';

const SpaceEditDialog = React.lazy(() =>
  import('./SpaceEditDialog').then(module => ({ default: module.SpaceEditDialog }))
);

interface SpaceDialogsProps
{
  showEditDialog: boolean;
  spaceToEdit: Space | null;
  onCloseEditDialog: () => void;

  showDeleteDialog: boolean;
  spaceToDelete: Space | null;
  onCloseDeleteDialog: () => void;

  onPerformAction?: (action: UndoableAction) => Promise<void>;
}

export const SpaceDialogs: React.FC<SpaceDialogsProps> = ({
  showEditDialog,
  spaceToEdit,
  onCloseEditDialog,
  showDeleteDialog,
  spaceToDelete,
  onCloseDeleteDialog,
  onPerformAction,
}) =>
{
  const { spaces, activeSpaceId, createSpace, updateSpace, setActiveSpaceId, windowId } = useSpacesContext();
  const { getItemKeyForTab, restoreItemAssociation } = useBookmarkTabsContext();

  const handleSaveSpace = async (spaceData: {
    name: string;
    icon: string;
    color: string;
    bookmarkFolderPath: string;
    bookmarkFolderSegments: string[];
    bookmarkFolderInAccount?: boolean;
  }) =>
  {
    if (spaceToEdit)
    {
      // Edit mode
      updateSpace(spaceToEdit.id, spaceData);
    }
    else
    {
      // Create mode
      const newSpace = createSpace(
        spaceData.name,
        spaceData.icon,
        spaceData.color,
        spaceData.bookmarkFolderPath,
        spaceData.bookmarkFolderSegments,
        spaceData.bookmarkFolderInAccount
      );
      // Switch to the newly created space
      setActiveSpaceId(newSpace.id);
    }
  };

  const handleDeleteSpace = () =>
  {
    if (!spaceToDelete || !windowId) return;

    const nextSpaceId = resolveSpaceIdAfterDeletion(
      spaces,
      spaceToDelete.id,
      activeSpaceId,
    );

    // Arc 始终保留至少一个 Space；最后一个 Space 不允许被删除。
    if (!nextSpaceId) return;

    const action = new DeleteSpaceAction(
      spaceToDelete.id,
      () => spaces,
      windowId,
      getItemKeyForTab,
      restoreItemAssociation
    );
    if (onPerformAction)
    {
      onPerformAction(action);
    }
    else
    {
      action.do();
    }
    if (activeSpaceId === spaceToDelete.id)
    {
      setActiveSpaceId(nextSpaceId);
    }
  };

  return (
    <>
      {showEditDialog && (
        <Suspense fallback={null}>
          <SpaceEditDialog
            isOpen
            space={spaceToEdit}
            existingSpaces={spaces}
            onClose={onCloseEditDialog}
            onSave={handleSaveSpace}
          />
        </Suspense>
      )}

      <SpaceDeleteDialog
        isOpen={showDeleteDialog}
        space={spaceToDelete}
        onClose={onCloseDeleteDialog}
        onConfirm={handleDeleteSpace}
      />
    </>
  );
};
