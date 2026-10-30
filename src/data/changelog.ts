// Maps version numbers to lists of user-facing feature changes introduced at that version.
// Omit a version entirely if it contains only bug fixes or internal changes.
// Entries are shown in the "What's New" dialog when the user upgrades past them.
export const CHANGELOG: Record<string, string[]> = {
  '1.0.352': [
    'New: Mark for Attention in the tab and bookmark right-click menu - marked rows get a green ring, auto-archive and bulk close leave marked tabs open, and the - button on a marked tab clears the mark',
    'New: Edit submenu in the bookmark right-click menu - "Replace Pinned URL with Current" saves the open tab\'s address as the bookmark URL; "Edit Pinned Page" opens the edit dialog',
    'New: "Archive tabs after" setting (Settings > Behaviour, off by default) - unused tabs are saved to the space\'s Archive and closed; unused open bookmark pages close and keep their bookmark',
    'New: Archive section between Bookmarks and Tabs - expand it to list and search archived tabs, click one to reopen it',
    'New: collapse the Bookmarks section from the space title - open bookmark pages stay visible',
    'New: "Mark unvisited tabs" setting (Settings > Appearance, on by default) - a dot marks tabs opened in the background until you first switch to them',
    'New: "Highlight tabs by last use" setting (Settings > Appearance, on by default) - tabs you left recently get a stronger background in the Tab list, fading over 3 hours; pick White, Accent, Cooling or Trail, or turn it off',
    'New: Archive button next to Clear on the "+ New Tab" row - saves the Tab list to the Archive and closes it, with Undo',
    'New: Tab Switcher and Space Switcher - hold the modifier and press the shortcut to step through tabs or Spaces by last use, release to switch. Set the shortcuts in chrome://extensions/shortcuts',
    'Removed: Space Navigator (Cmd+Shift+S) - the Space Switcher replaces it',
    'New: hover a collapsed folder to see its recently used pages, with search',
    'New: double-click a bookmark or Favorite whose tab moved to another page to load its page back in that tab',
    'Changed: switching to a Space brings its most recently used tab forward',
    'Changed: Favorites tiles follow the "Pinned icon size" setting',
  ],
};

function compareVersions(a: string, b: string): number
{
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++)
  {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface ChangelogGroup
{
  version: string;
  items: string[];
}

// Returns changelog groups for versions newer than lastSeenVersion, sorted newest-first.
// Returns an empty array if nothing is new (dialog should be skipped).
export function getWhatsNewSince(lastSeenVersion: string): ChangelogGroup[]
{
  return Object.entries(CHANGELOG)
    .filter(([version]) => compareVersions(version, lastSeenVersion) > 0)
    .sort(([a], [b]) => compareVersions(b, a))
    .map(([version, items]) => ({ version, items }));
}

// Returns the most recent `versionCount` changelog groups, for manual "What's New" opens.
export function getRecentWhatsNew(versionCount: number): ChangelogGroup[]
{
  return Object.entries(CHANGELOG)
    .sort(([a], [b]) => compareVersions(b, a))
    .slice(0, versionCount)
    .map(([version, items]) => ({ version, items }));
}
