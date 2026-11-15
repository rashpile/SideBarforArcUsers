/**
 * RecentTaskSpacesSection - the recent Task Spaces list with its actions. App puts it at the
 * bottom of the content column rather than in the Space bar: the Space bar spans the whole panel,
 * and in the vertical toolbar layout the list would cut across the toolbar column.
 */
import { useCallback } from 'react';
import { useSpacesContext, Space } from '../contexts/SpacesContext';
import { useRecentTaskSpaces } from '../hooks/useRecentTaskSpaces';
import { useCloseAllTabsInSpace } from '../hooks/useCloseAllTabsInSpace';
import { hiddenTaskSpacesProxy } from '../managers/proxies/hiddenTaskSpacesProxy';
import { RecentTaskSpacesList } from './RecentTaskSpacesList';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import type { UndoableAction } from '../actions/types';

interface RecentTaskSpacesSectionProps
{
  onEditSpace: (space: Space) => void;
  onDeleteSpace: (space: Space) => void;
  onPerformAction?: (action: UndoableAction) => Promise<void>;
  onShowToast: (message: string) => void;
}

export const RecentTaskSpacesSection = ({
  onEditSpace,
  onDeleteSpace,
  onPerformAction,
  onShowToast,
}: RecentTaskSpacesSectionProps) =>
{
  const { spaces, switchToSpace, convertToRegularSpace } = useSpacesContext();
  const { recent, now } = useRecentTaskSpaces();
  const { closeAllTabs, confirmation } = useCloseAllTabsInSpace(onPerformAction);

  const handleHide = useCallback(async (space: Space) =>
  {
    try
    {
      await hiddenTaskSpacesProxy.hide(space.id);
    }
    catch (error)
    {
      console.error('[RecentTaskSpaces] Failed to hide Task Space:', error);
      onShowToast('Could not hide the Task Space');
    }
  }, [onShowToast]);

  const handleConvertToRegular = useCallback((space: Space) =>
  {
    convertToRegularSpace(space.id);
  }, [convertToRegularSpace]);

  return (
    <>
      <RecentTaskSpacesList
        recent={recent}
        now={now}
        canDelete={spaces.length > 1}
        onSelect={(space) => switchToSpace(space.id)}
        onHide={handleHide}
        onEdit={onEditSpace}
        onDelete={onDeleteSpace}
        onCloseAllTabs={closeAllTabs}
        onConvertToRegular={handleConvertToRegular}
      />

      <ConfirmDeleteDialog
        isOpen={confirmation.isOpen}
        itemCount={confirmation.tabCount}
        itemType="tabs"
        details="This will close the window."
        onConfirm={confirmation.confirm}
        onClose={confirmation.cancel}
      />
    </>
  );
};
