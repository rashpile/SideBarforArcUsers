# Changelog

## Latest Version

- New: Recently Closed button on the Space title (shown on hover when the Space has closed tabs) - hover or click it for the Space's recently closed tabs, newest first, with the time each was closed. Click one to reopen it in the current window and that Space, without its Back/Forward history; Clear empties the list. Up to 50 per Space, kept across browser restarts; the same page closed again replaces its older entry. Tabs closed by auto-archive or the Archive button, bookmark and Favorite tabs, tabs a tab suspender replaces with its park page, incognito tabs and internal pages are not recorded. Deleting a Space deletes its list
- Fixed: an invalid URL in New Bookmark shows its error only in the dialog; it no longer stays under the Bookmarks tree after the dialog closes
- New: the search button on the Space title (hover or click, Arc style) shows the recently used pages of the whole Space folder, newest first, with search, like the button on a folder row
- Changed: hovering a tab or bookmark shows a flag button that marks it for attention or clears the mark, in place of the Pin button. Pin to Sidebar stays in the right-click menu and is now also in a single bookmark's menu and in the menu of a selection of several bookmarks
- Changed: each Space has its own Favorites. They are bookmarks in an `asd_Favorites` folder inside the Space's bookmark folder, so they sync with Chrome bookmarks and survive reinstalling the extension; custom icon, emoji and color stay in local storage (`favoriteIcons`). On update, the old global Favorites are copied once into every Space that has a bookmark folder, and open Favorite tabs keep their Favorite in their own Space. A Space without a bookmark folder shows a hint instead of Favorites. The Bookmarks tree, search, Expand All, Open All and folder pickers hide `asd_Favorites`
- New: Move to Space in a Favorite's right-click menu - moves it to another Space's Favorites; its open tab moves to that Space too
- Changed: the Tab Switcher lists a Favorite tab only in its own Space. Auto-archive never closes a tab on the page of any Space's Favorite
- Changed: JSON export and import work on the active Space's Favorites. Arc import puts Arc's Favorites into every Space it creates, or into the active Space
- Fixed: a tab you opened by hand on a bookmarked or Favorite page no longer jumps out of the Tab list into the bookmark (or into another Space) when another bookmark opens or closes. Open bookmark pages are still re-linked after a browser restart or extension reload
- New: `...` menu on the Archive header with Clear - Clear All, Older than 24 Hours, Older than 7 Days, Older than 30 Days. It clears the active Space's whole Archive regardless of the search; each option shows its count and is grayed out at 0. Clear All asks for confirmation; one Undo restores everything a Clear removed
- New: Mark for Attention in the right-click menu of tabs and bookmarks, also for a multi-selection - a marked row gets a ring; the item reads Clear Mark on a marked row. A marked tab's close button shows `-`, which clears the mark and leaves the tab open. Auto-archive never closes a marked tab, and bulk close commands (Close Tabs Before / After, Close Other Tabs, closing a selection, Close Tabs in Group, Clear, Archive, Close All Tabs In Space) leave marked tabs open. Marks survive a browser restart; incognito tabs can't be marked. The "Mark for Attention colour" setting (Settings > Appearance) picks the ring's colour - green, blue, orange, red, purple, yellow or the Space colour (the active Space's colour, also with the sidebar tint off; theme violet in the All view) - and strength: dim, normal or bright. The default is Space colour - dim
- Fixed: the active bookmark row now lines up with the other rows and is as wide as they are
- New: Edit submenu in a bookmark's right-click menu, as in Arc - "Replace Pinned URL with Current" sets the bookmark's URL to the page its open tab shows now (the title stays); "Edit Pinned Page" opens the edit dialog. It replaces "Rename..."
- Fixed: a tab opened from a link in a bookmark or Favorite page (Cmd+click) now goes to the top of the Tab list instead of a random spot
- New: "Mark unvisited tabs" setting (Settings > Appearance, on by default) - a dot at the left edge of a Tab list row marks a tab opened in the background until you first switch to it. Tabs restored with a closed window (Cmd+Shift+T) or brought back by Undo get no dot
- New: "Highlight tabs by last use" setting (Settings > Appearance, on by default) - Tab list rows get a stronger background the more recently you left the tab, fading out over 3 hours; looks: White, Accent, Cooling, Trail, or Off. Accent and Trail use the Space colour when it tints the sidebar
- New: "Archive tabs after" setting (Settings > Behaviour, off by default) - tabs unused for 12 hours to 30 days are saved to the Space's `asd_Archive` bookmark folder and closed; open bookmark pages close and keep their bookmark
- New: Archive section between Bookmarks and Tabs - expand it to list archived tabs, newest first, and search them from the header row; click one to reopen it
- New: Archive button next to Clear on the "+ New Tab" row - saves the Tab list's tabs to the Space's Archive and closes them right away; Undo reopens them and removes the new archive items
- New: collapse the Bookmarks section with the chevron on the Space title; collapsed, it still shows the open bookmark pages
- New: double-click a bookmark (Arc mode) or a Favorite whose tab has moved to another page to load the bookmarked page back in that tab
- Fixed: double-clicking a bookmark or Favorite with no open tab no longer opens two tabs
- Changed: Favorites tiles are a third lower and follow the "Pinned icon size" setting - a smaller icon gives lower tiles and more of them per row
- New: Tab Switcher - hold the modifier and press its shortcut to list the current Space's tabs and Favorites, most recently used first; press again to move, release to switch. Assign the shortcut in `chrome://extensions/shortcuts`
- New: Space Switcher - the same for Spaces; picking a Space opens its most recently used tab
- Removed: the Space Navigator window (Cmd+Shift+S) - the Space Switcher replaces it
- Changed: the extension now requests the `activeTab` permission (no install warning), used to draw the switcher list over the current page
- Changed: clicking a Space or swiping to it brings that Space's most recently used tab forward; a Space with no tabs opens a new tab
- Fixed: opening a bookmark no longer switches the sidebar to another Space when its tab had been recorded under the wrong Space
- Changed: the extension now requests the `alarms` permission (no install warning), used only while "Archive tabs after" is on
- Fixed: right-clicking the "Create a Space" placeholder header no longer opens an empty menu
- Fixed: after a browser restart, a reused tab ID no longer gives a pinned page's identity or a Space assignment to an unrelated tab on another site
- New: the search button on a bookmark folder row (hover or click) shows the folder's recently used pages, newest first, with search
- Improved: collapsed folders now keep all of their open pages visible, not only the active one
- Changed: Spaces now use persistent extension-owned Tab assignments instead of creating Chrome native tab groups
- Fixed: opening Spaces across multiple windows no longer accumulates duplicate Saved Tab Groups
- New: Arc-style folder collapse states, active descendant peek, New Tab ordering, and one-Space-at-a-time navigation
- Improved: fixed-page and Favorite recovery across Side Panel reopen, external tab suspension, and Chrome tab switching
- Improved: Arc-aligned active rows, folder icons, spacing, translucency, menus, and bottom Space navigation
- Fixed: tab history navigation (including keyboard shortcuts) and audio quick-jump now always take you to the tab, even when "Follow active tab" is Off
- Fixed: "Show active tab" button now works when the active tab is in another space

## 1.0.349

- Space membership is now independent from Chrome native tab groups; native groups remain user-owned
- Existing extension-owned live groups are ungrouped without closing their tabs during migration
- Added persistent Tab-to-Space recovery across extension reloads, browser restoration, navigation, sorting, and cross-window moves
- Removed the visible All Space and aligned folder, active-tab, New Tab, Favorites, and context-menu behavior more closely with Arc
- Fixed fixed-page duplication and stale active state after reopening the Side Panel or switching through Chrome's native tab UI

## Earlier versions

Versions before 1.0.349 are from upstream: see the [ChromeSideBar changelog](https://github.com/monemone-org/ChromeSideBar/blob/main/docs/changelog.md).
