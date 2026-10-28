## Summary from package
Arc Browser like Pinned Sites, Bookmarks and Active Tabs in Side Panel

## Description

I missed Arc's sidebar after switching to Chrome in how Arc puts favorites, bookmarks, and tabs all in one vertical list and its pinned tab support. So I built this extension to bring that experience to Chrome.

## Key Features

- Arc-Style Persistent Tabs - Bookmarks act as live tabs. Click to open, click again to jump back. Close tabs freely—bookmarks stay in the sidebar. Tab links survive browser restarts and extension reloads.

- Arc-Style Spaces - Isolated workspaces combining bookmark folders with persistent Tab assignments. Switch contexts with one click without generating duplicate Saved Tab Groups. Space Switcher cycles through Spaces by keyboard, Cmd+Tab style: hold the modifier, press the shortcut to move, release to switch.

- Arc-Style Unified Sidebar - Pinned favorites, bookmarks, and tabs in one vertical panel.

- Arc-Style Auto-Archive - Optionally close tabs you haven't used for 12 hours to 30 days. Unused tabs are saved to the space's Archive, where you can search them and reopen them with one click; open bookmark pages simply close and keep their bookmark. Off by default. To clean up the tab list right away, the Archive button next to Clear saves all its tabs to the Archive and closes them, with Undo.

- IDE-Style Tab History - Navigate by usage order like VS Code. Keyboard shortcuts: Cmd+Shift+< / >

- Tab Groups - Full support for Chrome's native tab groups. Drag, rename, recolor, save as bookmark folders.

- Drag & Drop Everything - Reorder pins, bookmarks, tabs, groups. Drop tabs into folders to save them.

- Search & Filter - Filter by text, live tabs, or audio. Save frequent searches. Export/import as JSON.

- Arc Browser Import - Migrate from Arc by importing your pinned sites, spaces, and bookmarks from Arc's `StorableSidebar.json`.

Open source on GitHub: https://github.com/lizeyan/SideBarforArcUsers

Full Changelog: https://github.com/lizeyan/SideBarforArcUsers/blob/main/docs/changelog.md

## Permission Justification

For the Privacy practices tab of the Chrome Web Store dashboard. Not part of the description above.

- `sidePanel`, `bookmarks`, `tabs`, `tabGroups` - Core features: show and manage bookmarks, tabs, and tab groups in the side panel
- `storage` - Save settings and sidebar state locally
- `favicon` - Show website icons
- `scripting` - Read page content only when requested for AI-assisted naming
- `alarms` - Wake the extension every few minutes while "Archive tabs after" is on, to close tabs left unused longer than the chosen period. Not used while the setting is Never
- Optional host permissions `http://*/*` and `https://*/*` - Requested at use time, only for reading a page's content for AI-assisted naming and for calling the AI endpoint the user configured
