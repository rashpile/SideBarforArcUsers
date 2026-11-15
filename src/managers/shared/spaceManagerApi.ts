// The wire contract for SpaceManager, owned by neither side.
//
// impl/spaceManager.ts implements SpaceManagerApi;
// proxies/spaceManagerProxy.ts implements Remote<SpaceManagerApi>.
// Both import this file, so the two signatures cannot drift apart silently -
// and neither has to import the other.

import { ManagerId, makeManagerActionId } from '../proxies/messageRouting';
import { Space } from '../../utils/spaceMessages';

/**
 * The subset of SpaceManager the sidebar can call.
 */
export interface SpaceManagerApi
{
  getSpaces(): readonly Space[];
  /** Archived Task Spaces, oldest archive first. */
  getArchivedTaskSpaces(): readonly Space[];
  /**
   * Returns the resulting list, which becomes the ack payload. Async because
   * the manager may need to resolve missing bookmarkFolderSegments (a fresh
   * chrome.bookmarks.getTree() walk) before it can say what the result is -
   * see impl/spaceManager.ts's resolveMissingSegments. Ids of archived Task
   * Spaces are dropped from the list.
   */
  updateSpaces(spaces: Space[]): Promise<readonly Space[]>;
  /** Moves an archived Task Space back to the end of the live list. */
  restoreTaskSpace(spaceId: string): Promise<void>;
  /** Removes an archived Task Space for good; its bookmark folder stays. */
  deleteArchivedTaskSpace(spaceId: string): Promise<void>;
}

/**
 * Broadcast to every listening context when either Space list changes - a
 * manager -> everyone message, rather than a reply to one caller. Carries
 * both lists: `spaces` (live) and `archived` (archived Task Spaces).
 *
 * It lives here with the rest of this manager's contract so the 'changed'
 * method name is spelled exactly once. A typo in a second hand-written copy
 * would silently stop all cross-window sync with no compile error.
 */
export const SPACES_CHANGED = makeManagerActionId(ManagerId.SPACES, 'changed');
