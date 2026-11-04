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

- Markdown Notes - New Note in a folder's menu adds a note next to the folder's bookmarks. Write it in markdown in its own tab; it shows rendered when you open it again. A note moves, renames and deletes with Undo like any bookmark, and Export / Import carries its text to another computer.

- Page Agent (experimental) - Ask an AI model to restyle the page or answer questions about it, including the subtitles of the video on the page. Save a style to a bookmark and it comes back whenever a page of that site loads in the bookmark's tab. With the optional Page scripts plugin it can also add behaviour with JavaScript, such as keys that seek a video to the next subtitle line, after you read the code and allow it. Or paste your own CSS and JavaScript into its code editor and apply them to the page. Uses your own AI endpoint.

- Arc Browser Import - Migrate from Arc by importing your pinned sites, spaces, and bookmarks from Arc's `StorableSidebar.json`.

Open source on GitHub: https://github.com/rashpile/SideBarforArcUsers

Full Changelog: https://github.com/rashpile/SideBarforArcUsers/blob/main/docs/changelog.md

## Permission Justification

For the Privacy practices tab of the Chrome Web Store dashboard. Not part of the description above.

- `sidePanel`, `bookmarks`, `tabs`, `tabGroups` - Core features: show and manage bookmarks, tabs, and tab groups in the side panel
- `storage` - Save settings and sidebar state locally
- `favicon` - Show website icons
- `scripting` - Read page content only when requested for AI-assisted naming. For the experimental page agent: read the text of the page the user asks about, read the subtitles of the video on that page when the user asks about the video, read the layout and element sizes of the page the user asks it to change, insert or remove the CSS it applies there or the CSS the user applies from the page agent's code editor, and show the agent's answer in a popup on that page, built by the extension from the answer's text without parsing it as HTML. Prime Video's player loads its subtitle list only when it opens, so on Prime Video the user's first video question adds a wrapper around the page's `fetch` that keeps only that list, in the page, until the page reloads; the subtitle file is then downloaded inside the page without cookies, only from Prime's subtitle servers. When the user saved that CSS to a bookmark with Auto-apply on, insert it again into the bookmark's tab when a page of the same site loads there. The extension refuses the agent's CSS when it would load anything from the network. CSS the user pastes or writes in the code editor is the user's own: the extension checks only its size, also when it is saved and inserted again, so the fonts, images and `@import` it names load from their servers
- `webNavigation` - Notice when a page starts loading (`webNavigation.onCommitted`, top frame only) in a tab the user opened from a bookmark or Favorite, so a page style the user saved to that bookmark is applied as the page loads. Only tabs linked to a bookmark with a saved style and Auto-apply on are acted on; the navigation data is not stored or sent anywhere
- `activeTab` - Draw the Tab Switcher and Space Switcher list over the current page when the user presses their shortcut
- `alarms` - Wake the extension every few minutes while "Archive tabs after" is on, to close tabs left unused longer than the chosen period. Not used while the setting is Never
- Optional host permissions `http://*/*` and `https://*/*` - Requested at use time, only for reading a page's content for AI-assisted naming, for the page agent to read the page the user asks about, restyle it or show an answer on it, and for calling the AI endpoint the user configured
- Optional host permission `<all_urls>` - Requested only when the user turns on "Model accepts images" and presses "Grant screenshot access" in the page agent drawer. `chrome.tabs.captureVisibleTab` needs it to take a screenshot of the visible tab, which goes to the user's AI endpoint so the model can check the change it made. Without it the page agent works on measurements only
- Optional `userScripts` - Requested only when the user turns on the "Page scripts" plugin of the experimental page agent in Settings > AI, which is off by default, or presses Allow scripts in the page agent's code editor for a script of their own (see the end of this item); Chrome additionally requires the user to turn on "Allow User Scripts" on the extension's Details page, which the extension can't do. The page agent then can write JavaScript for changes CSS can't make, such as keys that seek a video to the next subtitle line, and run it with `chrome.userScripts.execute` in the tab the user asked about. Turning the plugin on first shows the user a warning about what scripts can do. Before the first script of each request runs, the side panel shows the user its full code and the site with Allow and Deny; nothing runs until the user presses Allow, Allow covers the request's other scripts only on that same site, and Deny refuses every script of that request. Scripts run in a USER_SCRIPT world of the extension, one per page origin, in the top frame only; the world's CSP limits a script's fetch and XHR requests to the page's own origin. The code comes from the AI model the user configured; the user reads it in the panel before it runs, and it is kept in the tab's chat. The user can save a script to a bookmark together with the CSS; it then runs again when a page of that site loads in the bookmark's tab, as the saved CSS does. Undo removes what the script added. The page agent's code editor shows its Allow scripts button when the user pastes or writes a script there and the permission isn't granted yet. Such a script runs only when the user presses Apply, in the same USER_SCRIPT world and with the same limits; it needs neither the Page scripts plugin nor an Allow / Deny step, since the user wrote or pasted it and applied it. It is kept in the tab's chat and, after Save to bookmark, with the saved style
