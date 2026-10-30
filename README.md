# Side Bar for Arc Users — Arc Style

Arc's sidebar in Chrome's Side Panel. Favorites, pinned pages, folders and tabs sit in one vertical list, grouped into Spaces, and behave the way they do in Arc wherever Chrome's extension APIs allow it.

Chrome still draws its own tab strip, address bar and Side Panel header. An extension can't replace those, so the work goes into everything inside the panel.

![The sidebar in light and dark mode](asset/sidebar.png)

## Install

The extension is not in the Chrome Web Store. The "Sidebar for Arc Users" listing there is the upstream project, not this fork.

Build it from source (Node.js 18+):

```bash
git clone https://github.com/rashpile/SideBarforArcUsers.git
cd SideBarforArcUsers
make install
make build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist/` folder. Open the sidebar with the extension icon or `Cmd+Shift+E` (`Ctrl+Shift+E` on Windows and Linux).

To update, run `git pull && make build` and press reload on the extension's card in `chrome://extensions`.

Coming from Arc? **Import from Arc Browser...** in the sidebar menu reads Arc's `StorableSidebar.json` and brings over your Favorites, Spaces and pinned pages.

## How it fits together

- **Favorites** are the icon grid at the top. They stay the same in every Space.
- **Spaces** each link one bookmark folder with their own set of tabs, plus a name, icon and color. You see one Space at a time and switch from the bar at the bottom.
- **Pinned pages** are the bookmarks in the Space's folder. Click one and it opens as its tab. Close the tab and the bookmark stays in place, like a pinned tab in Arc.
- **Tabs** below the bookmarks are the Space's other open tabs.
- **Archive** keeps tabs you stopped using, if you turn auto-archive on.

Everything is stored in Chrome: bookmarks for Spaces, pinned pages and the archive, and the extension's local storage for settings and Favorites. Nothing goes to a server. See [PRIVACY.md](PRIVACY.md).

## Features

### Favorites

- Icon grid at the top of the panel. Tile height follows the **Pinned icon size** setting (12-48px)
- Pin a bookmark or a tab, drag to reorder
- Custom icon, emoji and color per Favorite
- Click opens it as an Arc-style tab. `Cmd/Ctrl+Click` opens a background tab, `Shift+Click` a new window
- A dot marks an open Favorite, a triangle one that plays audio
- Double-click a Favorite whose tab moved on to another page to load the Favorite's page back in that tab
- Right-click: Edit (title, URL, icon, color), Duplicate, Reset favicon, Unpin, Move to New Window

### Bookmarks and pinned pages

- The Space's bookmark folder as a tree
- Click a folder row to expand or collapse it. A collapsed folder still shows its open pages, the active one as a card
- Hover a collapsed folder to see its recently used pages, newest first, with search
- Collapse the whole section with the chevron on the Space title. Open pages stay visible. The state is kept per Space and shared across windows
- Double-click a bookmark whose tab moved on to another page to load the bookmarked page back in that tab
- Links you open from a bookmark or Favorite page (`Cmd+Click`) land at the top of the Tab list
- Drag and drop to organize. Drag a tab onto the tree to bookmark it
- `...` menu: New Folder, New Bookmark, Sort by Name/Date, Edit, Duplicate, Delete, Pin, Move to New Window, Expand All, Open as Tab Group
- Right-click a bookmark: Copy Link, Share, AI Rename, Edit, Mute/Unmute, Duplicate, Move to..., Remove Pin. **Edit** opens a submenu: **Replace Pinned URL with Current** (when the page is open) saves the tab's current address as the bookmark's URL and keeps its title; **Edit Pinned Page** opens the dialog to change title and URL
- A speaker icon for pages playing audio, an X on hover to close the tab

### Tabs

- The current Space's tabs that aren't pinned pages
- Recently left tabs get a stronger background that fades over 3 hours. Pick White, Accent, Cooling or Trail in Settings, or turn it off

  ![Tab age highlight looks](asset/tab-age-highlight-light.png)

- A dot at the left edge marks a tab opened in the background (`Cmd+Click`, "Open link in new tab") until you first switch to it. Turn it off with **Mark unvisited tabs** in Settings
- Drag to reorder, click to switch, X on hover to close
- "+ New Tab" row at the bottom, with **Clear** (close the list's tabs) and **Archive** (save them to the Archive, then close). Both can be undone
- Right-click: Pin to Sidebar, Add to Group, Add to Bookmark, Move to New Window, Duplicate, Close, Close Tabs Before / After / Other Tabs
- Sort by domain, then title (A-Z or Z-A)
- Chrome tab groups show with their color and title. Group menu: New Tab, Sort by Domain, Save to Bookmarks, Rename, Change Color, Close All. Drag tabs in and out of groups, reorder groups, drop a group on the bookmark tree to save it as a folder

### Spaces

- A Space is a bookmark folder plus a set of real Chrome tabs, with a name, icon and color
- One Space is visible at a time. There is no "All" view
- Switch with the icons at the bottom or a two-finger swipe. Switching brings the Space's most recently used tab forward. A Space with no tabs opens a new tab
- New tabs (`Cmd+T`) belong to the active Space
- Space membership doesn't depend on Chrome tab groups. Your own groups work normally inside a Space, and moving a tab between windows keeps its Space
- Create with "+" in the bar: name, icon, color and bookmark folder (created if missing)
- Right-click a Space icon to edit or delete it. The last Space can't be deleted
- Optionally tint the sidebar with the Space's color
- Use a bookmark folder for one Space only. Two Spaces on one folder aren't blocked, but bookmarks then resolve to whichever Space comes first

### Archive

Off by default. Turn it on with **Archive tabs after** in Settings: 12 hours, 24 hours, 3 days, 7 days or 30 days.

- Tabs from the Tab list that you haven't used for that long are saved as bookmarks in an `asd_Archive` folder inside the Space's folder, then closed
- Open pinned pages unused for that long are closed. Their bookmark stays. If the tab had moved on to another page, that page is archived first
- Empty pages (New Tab, `about:blank`) close without a bookmark
- Never closed: the active tab of each window and the tab next to it in split view, tabs playing audio, Chrome-pinned tabs, Favorites and tabs showing a Favorite's page, incognito tabs, and tabs with no Space or whose Space has no folder
- "Unused" counts from the moment you switched away, including while Chrome is closed or the computer sleeps
- Turning the setting on starts every tab's clock at that moment, so nothing closes right away
- Archiving a URL again replaces the older item. Archived items are never deleted automatically

The **Archive** section sits between Bookmarks and Tabs. Hover the header for the newest items and a search box. Click it to list everything, newest first, with the time each was archived. Click an item to reopen it in the active Space. Right-click to delete it (with Undo).

The extension hides `asd_Archive` in the sidebar, search and folder pickers. Chrome's bookmark bar and Bookmark Manager still show it.

### Search and filters

- Search titles and URLs across Favorites, bookmarks, tabs and the active Space's archive
- Saved filters and the last 5 searches in a dropdown
- Show only items with an open tab, or only items playing audio
- One button clears all filters

### Keyboard

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+E` / `Ctrl+Shift+E` | Open the sidebar |
| `Cmd+Shift+<` / `Ctrl+Shift+<` | Previous tab in this window's history |
| `Cmd+Shift+>` / `Ctrl+Shift+>` | Next tab in history |
| not set | Tab Switcher: hold the modifier, press to list the Space's tabs by last use, press again to move, release to switch |
| not set | Space Switcher: the same for Spaces |

Set or change shortcuts in `chrome://extensions/shortcuts`.

### Settings

Gear menu → Settings:

- Font size (6-36px) and Pinned icon size (12-48px)
- **Open bookmark**: Arc style (pinned pages act as tabs and are hidden from the Tab list), in a new tab, or in the active tab
- **Follow active tab**: switch Space, switch and scroll, or keep the sidebar where it is
- **Archive tabs after**: Never, or 12 hours to 30 days
- **Highlight tabs by last use**: Off, White (default), Accent, Cooling or Trail
- **Mark unvisited tabs**: a dot on tabs opened in the background that you haven't switched to yet. On by default
- Space color tint
- **AI naming**: rename Favorites and pinned pages with an OpenAI-compatible API you configure (endpoint, model, prompt, automatic or manual)

### Backup

Export Favorites, bookmarks and tabs to a JSON file, and import them back: replace or append Favorites, replace bookmarks or add them as a subfolder, replace the session or add tabs to the current window.

Light and dark mode follow your system.

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel`, `bookmarks`, `tabs`, `tabGroups` | Show and manage bookmarks, tabs and groups |
| `storage` | Settings and sidebar state, stored locally |
| `favicon` | Website icons |
| `scripting` | Read a page's text, only when you ask for AI naming |
| `activeTab` | Draw the Tab and Space Switcher over the current page |
| `alarms` | Check for unused tabs every few minutes while auto-archive is on |
| Optional `http://*/*`, `https://*/*` | Asked for when you use AI naming, to read the page and call your AI endpoint |

## More

- [Changelog](docs/changelog.md)
- [Privacy](PRIVACY.md)
- [Development](docs/development.md): build, tests, architecture
- Issues and ideas: [GitHub issues](https://github.com/rashpile/SideBarforArcUsers/issues)

## Credits

This fork started from [monemone-org/ChromeSideBar](https://github.com/monemone-org/ChromeSideBar) by monehsieh, through [lizeyan/SideBarforArcUsers](https://github.com/lizeyan/SideBarforArcUsers), which moved Spaces off Chrome tab groups and rebuilt the visuals after Arc. It is maintained on its own and doesn't merge back upstream. The bigger differences from upstream are one Space at a time, Space membership independent of tab groups, auto-archive, the switchers and the Arc-style visuals.

Licensed under the [Apache License 2.0](LICENSE). Third-party licenses are in [LICENSES.md](LICENSES.md).
