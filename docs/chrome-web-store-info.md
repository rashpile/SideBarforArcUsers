## Summary from package
Arc Browser like Pinned Sites, Bookmarks and Active Tabs in Side Panel

## Description

I missed Arc's sidebar after switching to Chrome in how Arc puts favorites, bookmarks, and tabs all in one vertical list and its pinned tab support. So I built this extension to bring that experience to Chrome.

## Key Features

- Arc-Style Persistent Tabs - Bookmarks act as live tabs. Click to open, click again to jump back. Close tabs freely—bookmarks stay in the sidebar. Tab links survive browser restarts and extension reloads.

- Arc-Style Spaces - Isolated workspaces combining bookmark folders with persistent Tab assignments. Switch contexts with one click without generating duplicate Saved Tab Groups. Space Switcher cycles through Spaces by keyboard, Cmd+Tab style: hold the modifier, press the shortcut to move, release to switch.

- Arc-Style Unified Sidebar - Pinned favorites, bookmarks, and tabs in one vertical panel.

- Arc-Style Auto-Archive - Optionally close tabs you haven't used for 12 hours to 30 days. Unused tabs are saved to the space's Archive, where you can search them and reopen them with one click; open bookmark pages simply close and keep their bookmark. Off by default. To clean up the tab list right away, Archive in the "+ New Tab" row's `...` menu saves all its tabs to the Archive and closes them, with Undo.

- Tab Age Highlight - Tabs you left recently get a stronger background in the tab list, so you can find where you just were. The highlight fades over 3 hours. Four looks: White, Accent, Cooling and Trail. On by default; turn it off in Settings.

- Unvisited Tab Marker - A dot marks tabs you opened in the background until you first switch to them. On by default; turn it off in Settings.

- Mark for Attention - Flag tabs and bookmarks from the right-click menu; marked rows get a ring in the Space's colour (colour and strength set in Settings). Auto-archive and bulk close commands leave marked tabs open, and marks survive a browser restart.

- IDE-Style Tab History - Navigate by usage order like VS Code. Keyboard shortcuts: Cmd+Shift+< / >

- Tab Groups - Full support for Chrome's native tab groups. Drag, rename, recolor, save as bookmark folders.

- Drag & Drop Everything - Reorder pins, bookmarks, tabs, groups. Drop tabs into folders to save them.

- Search & Filter - Filter by text, live tabs, or audio. Save frequent searches. Export/import as JSON.

- Arc Browser Import - Migrate from Arc by importing your pinned sites, spaces, and bookmarks from Arc's `StorableSidebar.json`.

Open source on GitHub: https://github.com/rashpile/SideBarforArcUsers

Full Changelog: https://github.com/rashpile/SideBarforArcUsers/blob/main/docs/changelog.md

## Permission Justification

For the Privacy practices tab of the Chrome Web Store dashboard. Not part of the description above.

- `sidePanel`, `bookmarks`, `tabs`, `tabGroups` - Core features: show and manage bookmarks, tabs, and tab groups in the side panel
- `storage` - Save settings and sidebar state locally
- `favicon` - Show website icons
- `scripting` - Read page content only when requested for AI-assisted naming. For the experimental page agent: read the text of the page the user asks about, read the layout and element sizes of the page the user asks it to change, insert or remove the CSS it applies there, and show the agent's answer in a popup on that page, built by the extension from the answer's text without parsing it as HTML. When the user saved that CSS to a bookmark with Auto-apply on, insert it again into the bookmark's tab when a page of the same site loads there
- `webNavigation` - Notice when a page starts loading (`webNavigation.onCommitted`, top frame only) in a tab the user opened from a bookmark or Favorite, so a page style the user saved to that bookmark is applied as the page loads. Only tabs linked to a bookmark with a saved style and Auto-apply on are acted on; the navigation data is not stored or sent anywhere
- `activeTab` - Draw the Tab Switcher and Space Switcher list over the current page when the user presses their shortcut
- `alarms` - Wake the extension every few minutes while "Archive tabs after" is on, to close tabs left unused longer than the chosen period. Not used while the setting is Never
- Optional host permissions `http://*/*` and `https://*/*` - Requested at use time, only for reading a page's content for AI-assisted naming, for the page agent to read the page the user asks about, restyle it or show an answer on it, and for calling the AI endpoint the user configured
- Optional host permission `<all_urls>` - Requested only when the user turns on "Model accepts images" and presses "Grant screenshot access" in the page agent drawer. `chrome.tabs.captureVisibleTab` needs it to take a screenshot of the visible tab, which goes to the user's AI endpoint so the model can check the change it made. Without it the page agent works on measurements only
