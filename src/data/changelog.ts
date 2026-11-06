// Maps version numbers to lists of user-facing feature changes introduced at that version.
// Omit a version entirely if it contains only bug fixes or internal changes.
// Entries are shown in the "What's New" dialog when the user upgrades past them.
export const CHANGELOG: Record<string, string[]> = {
  '2.0.388': [
    'New: search popup - a shortcut opens one field over the page that finds open tabs, Space bookmarks, archived pages and recently closed tabs, in This Space or All Spaces, and lists each page once; pick a result to switch to it or open it, or press Shift+Enter to search the web for what you typed. Set the shortcut in chrome://extensions/shortcuts',
    'New: Toolbar setting in Settings > Appearance - Vertical puts the toolbar buttons in a column at the left edge of the panel, and their menus open to the right; the button at the top of the column widens it, with a label on each button, and the Space buttons sit at the right of the Space bar',
    'New (experimental): Page scripts for the page agent (Settings > AI, off by default) - it can add behaviour with JavaScript, such as keys that seek a YouTube video to the next subtitle line. You see the code and allow it once per request on that site; Undo removes it, and Save to bookmark keeps it with the CSS. Chrome also needs Allow User Scripts on the extension\'s Details page',
    'New (experimental): page agent code editor - Code beside Send, or Edit code next to Show code, lets you paste or edit CSS and JavaScript and Apply them to the page; Undo, Save to bookmark and the agent\'s follow-ups work on them as on the agent\'s code. Your CSS isn\'t checked for network loads, and your scripts run without the Page scripts switch',
    'New: Switch to Space 1–9 shortcuts - jump to the Space at that position in the Space bar. Set them in chrome://extensions/shortcuts, for example Control+1 … Control+9 on macOS',
    'Changed: closing the active tab switches to the tab you used before it in the same Space, not to its neighbour in the tab strip; a Space with no other open tab gets a new tab',
    'Changed: Cmd+. (Ctrl+. with Ctrl) closes the Tab Switcher, the Space Switcher and the search popup without switching, as Esc does - on macOS Cmd+Esc often doesn\'t reach Chrome',
    'Removed: AI Rename and automatic naming of new Favorites, pinned pages and bookmarks - the AI settings and your API key stay for the page agent',
  ],
  '2.0.387': [
    'New: markdown notes - New Note in a folder\'s menu puts a note next to the folder\'s bookmarks; write it in markdown in its tab, and it shows rendered when you open it again. The text stays on this computer, and Export / Import with Notes carries it to another one',
    'New (experimental): page agent - the sparkles button in the toolbar asks an AI model to restyle the page or answer questions about it, and Show on page puts an answer in a popup on the page; Save to bookmark keeps its CSS and puts it back whenever a page of that site loads in the bookmark\'s or Favorite\'s tab, also after a browser restart. Bookmarks with a saved style show a brush, and their right-click menu has a Page style submenu',
    'New (experimental): page agent plugins in Settings > AI - the first, Video transcripts (on by default), reads the subtitles of the video on the page, on Prime Video and on pages with subtitle tracks, so the agent can summarize it, say what happened so far without spoiling the rest, or explain what was just said',
    'New: Copy as YAML and Paste from YAML in the bookmark folder menu and the Space menu - share a set of links, keep them in notes or write them by hand, with Undo',
    'New: Archive button on hover and Archive in the right-click menu of tabs - also for a multi-selection, or drag tabs onto the Archive section; marked tabs stay open, with Undo',
    'New: Recently Closed button on the Space title - hover or click it to reopen the Space\'s recently closed tabs',
    'New: search button on the Space title - hover or click it to see the Space\'s recently used pages, with search',
    'Changed: the hover button on tabs and bookmarks marks them for attention instead of pinning - Pin to Sidebar is in the right-click menu, now also for bookmarks',
    'Changed: each Space has its own Favorites, stored as bookmarks in an asd_Favorites folder inside the Space folder - your current Favorites are copied into every Space that has a bookmark folder',
    'New: Move to Space in a Favorite\'s right-click menu - its open tab moves along',
    'New: Clear in the Archive header\'s ... menu - remove everything or pages older than 24 hours, 7 days or 30 days, with Undo',
    'New: Mark for Attention in the tab and bookmark right-click menu - marked rows get a ring in the Space colour, auto-archive and bulk close leave marked tabs open, and the - button on a marked tab clears the mark; pick the ring\'s colour and strength in Settings > Appearance',
    'New: Edit submenu in the bookmark right-click menu - "Replace Pinned URL with Current" saves the open tab\'s address as the bookmark URL; "Edit Pinned Page" opens the edit dialog',
    'New: "Archive tabs after" setting (Settings > Behaviour, off by default) - unused tabs are saved to the space\'s Archive and closed; unused open bookmark pages close and keep their bookmark',
    'New: Archive section between Bookmarks and Tabs - expand it to list and search archived tabs, click one to reopen it',
    'New: collapse the Bookmarks section from the space title - open bookmark pages stay visible',
    'New: "Mark unvisited tabs" setting (Settings > Appearance, on by default) - a dot marks tabs opened in the background until you first switch to them',
    'New: "Highlight tabs by last use" setting (Settings > Appearance, on by default) - tabs you left recently get a stronger background in the Tab list, fading over 3 hours; pick White, Accent, Cooling or Trail, or turn it off',
    'New: "..." menu on the "+ New Tab" row with Archive and Clear - Archive saves the Tab list to the Archive and closes it, with Undo',
    'New: Tab Switcher and Space Switcher - hold the modifier and press the shortcut to step through tabs or Spaces by last use, release to switch. Set the shortcuts in chrome://extensions/shortcuts',
    'Removed: Space Navigator (Cmd+Shift+S) - the Space Switcher replaces it',
    'New: search button on a bookmark folder row - hover or click it to see the folder\'s recently used pages, with search',
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
