# Privacy Policy for Side Bar for Arc Users — Arc Style

## Data Collection

This extension does not collect personal data and has no server. The developer receives nothing. The only data that leaves your device is described under External Services below. The page agent sends data only to the endpoint you configure.

## Local Storage

The extension stores the following data locally on your device using Chrome's storage API:

- Favorites' custom icons, emoji and icon colors (the Favorites themselves are Chrome bookmarks in each Space's `asd_Favorites` folder)
- Favicons (stored as base64 image data)
- User preferences (font size, icon size, display settings)
- The page agent's AI settings, including the API key you enter and the page agent plugin switches
- The page agent drawer's height
- Page agent chats: your requests, the conditions, the agent's steps, its answers, and the CSS and script applied to the tab, by the agent or by you from the code editor, one chat per tab; while the agent waits for your Allow or Deny, also the code of that script (stored in `chrome.storage.session`, which Chrome clears when the browser closes). Closing the tab deletes its chat; if no side panel is open at that moment, the next side panel to open deletes it, or Chrome when the browser closes. Screenshots are never stored; they stay in the open side panel's memory. The answer popup on a page stores nothing; it stays in the page until you close it, reload the page or move to another page. Code editor drafts are never stored; they stay in the open side panel's memory until you apply or cancel them, close the tab or close the side panel
- The URL, window, position in the window, and last-use times of each open tab, and whether you have switched to it since it was opened, recorded while "Archive tabs after", "Highlight tabs by last use" or "Mark unvisited tabs" is turned on, so the extension knows how long a tab has been unused, how recently you left it and which tabs you haven't looked at yet (stored in `chrome.storage.local`; incognito tabs are never recorded). "Highlight tabs by last use" and "Mark unvisited tabs" are on by default, so the extension records them unless you turn both off. Setting "Archive tabs after" to "Never", "Highlight tabs by last use" to "Off" and turning "Mark unvisited tabs" off deletes them
- Page styles you save to a bookmark or Favorite with the page agent's **Save to bookmark**: the CSS and the script, the agent's or your own from the code editor, whether the CSS is your own, the origin of the page it was saved on, such as `https://example.com`, and the Auto-apply setting, per bookmark (stored in `chrome.storage.local`). Remove in the drawer or the bookmark's Page style menu, or deleting the bookmark, deletes it
- The text of each note you write with New Note, and when it was last edited (stored in `chrome.storage.local`). The note's title and place are an ordinary Chrome bookmark, which Chrome syncs like your other bookmarks if Chrome Sync is on; the text is not synced. A JSON backup you export with Notes holds the texts. After you delete a note's bookmark, the extension deletes its text once 30 days have passed, unless a bookmark of that note is back by then
- The URL, window and position in the window of each tab you mark with "Mark for Attention", and the IDs of bookmarks you mark, so the marks survive a browser restart (stored in `chrome.storage.local`; incognito tabs can't be marked). Clearing a mark, closing the tab or deleting the bookmark deletes its entry
- The URL, title and close time of tabs you close, up to 50 per Space, for the Recently Closed list (stored in `chrome.storage.local`). Clear in the Recently Closed list or deleting the Space deletes them. Incognito tabs are never recorded
- The URL, title and Space of each open tab, so a close can be recorded after the extension's background worker has slept (stored in `chrome.storage.session`, which Chrome clears when the browser closes; incognito tabs are kept out of the Recently Closed list)

This data stays on your device and is not accessible to the developer or any third party.

## External Services

- **Iconify API**: The extension connects to `api.iconify.design` to fetch icon images when you customize Favorite icons.
- **Favicons**: The extension may fetch favicons directly from websites you pin to store them locally for faster loading.
- **Web search from the search popup**: When you press `Shift+Enter` or click **Search the web** in the search popup, Chrome sends the text in its field to your browser's default search engine, as a search from the address bar does. The extension sends nothing to the search engine at any other time and doesn't read the results.

The Iconify and favicon requests send no user data beyond standard HTTP headers.

## Page Agent (experimental)

The page agent sends nothing until you type a request in its drawer. While it works on a request in a tab:

- The extension reads from that tab, after asking for host permission: its URL and title, the text of the page's main content (up to 30,000 characters) when the agent asks for it, an outline of the page's visible layout (element names, ids, classes, sizes and positions, and up to 40 characters of each element's own text), and the sizes, positions and computed styles of the elements the agent asks to inspect.
- When you ask about a video and the Video transcripts plugin is on (the default; switch it off under Page agent plugins in Settings > AI), it reads the video's subtitles, the list of subtitle languages, the video's duration and the playback position. On most pages it reads them from the video's subtitle tracks. On Prime Video the first video question adds a wrapper around the page's `fetch` function. From the request Prime's player makes when it opens, the wrapper keeps only the list of subtitle files (language, name and address), and only in the page until you reload it; the extension stores none of it. The extension then downloads the subtitle file inside the page, without cookies, and only from Prime's subtitle servers.
- With "Model accepts images" turned on in Settings, and after you allow access to all pages, it takes screenshots of the visible part of the tab while the tab is the active one in its window.
- It sends the page text, the outline, the inspect results, the screenshots, the subtitle text it read (up to 60,000 characters per read) with the video's languages, duration and position, your requests, a summary of the tab's earlier messages with the agent's earlier answers (up to 4,000 characters each), the CSS and scripts the agent wrote and what its scripts returned (up to 12,000 characters per script), and the CSS and script you applied from the code editor, as the tab's current code, to the endpoint you configured, using your API key and without cookies. The endpoint must use HTTPS unless it runs on this computer (localhost), so the key and the page data are not sent unencrypted over the network.
- It changes the page by inserting CSS into that tab, by showing the agent's answers in a popup the extension adds to the page, built from the answer's text, and on Prime Video by the subtitle `fetch` wrapper described above. It rejects the agent's CSS when it would load anything from the network, and the popup loads nothing: images in an answer stay text, and a link opens only when you click it.
- It runs JavaScript written by the model only with the Page scripts plugin on (off by default; Settings > AI > Page agent plugins), with the `userScripts` permission granted and Allow User Scripts turned on for the extension in Chrome. Turning the plugin on first shows a warning about what scripts can do. The first script of each request shows its code and the site, and runs only after you press Allow; Allow covers the other scripts of that request on the same site only, and Deny refuses every script of that request. A script runs in that tab's top frame, in a separate world of the extension, and can read and change anything on the page, as you could with your login there. The extension blocks a script's fetch and XHR requests to other sites, but a script can still navigate the page, open a window or a frame, or submit a form, so it could still send page data elsewhere that way. What a script returns is kept, shortened, in the chat's steps.
- What that service does with the request is governed by its own privacy policy. The extension doesn't send this data anywhere else.

The code editor in the drawer puts CSS and JavaScript you paste or write on the page when you press Apply. Applying sends nothing to the AI endpoint; the code goes there only with your next request in that chat, as described above. The extension doesn't check this CSS for network loads: the fonts, images and `@import` it names load from their servers, which learn that you opened the page, also each time Auto-apply puts a saved copy back. Your scripts run with the `userScripts` permission and Allow User Scripts turned on, like the agent's, in the same separate world with the same limits on fetch and XHR, but without the Page scripts plugin and without an Allow / Deny step: pressing Apply is your consent. The tab's chat keeps your code, and Save to bookmark stores it with the saved style.

When you save a page style to a bookmark and leave Auto-apply on, the extension acts without a request: whenever a page of the site the style was saved on loads in that bookmark's tab, it reads a marker from the page (whether the saved style is already there), inserts the saved CSS and, when the style has a script and Chrome allows user scripts, runs the script without asking again. The extension reads nothing else from the page, and nothing of this goes to the AI endpoint or anywhere else; a saved script reaches the network only as described above, and saved CSS from the code editor loads what it names. Saved scripts run with the Page scripts plugin off too; turning off Allow User Scripts stops them. Tabs you opened by hand and incognito tabs are left alone.

## Bookmarks and Tabs

The extension reads your Chrome bookmarks and tabs to display them in the sidebar.

When "Archive tabs after" is turned on in Settings, the extension also creates bookmarks: before it closes an unused tab, it saves the tab's title and URL as a bookmark in an `asd_Archive` folder inside the Space's bookmark folder. These are ordinary Chrome bookmarks. The extension does not send them anywhere; if Chrome Sync is on, Chrome syncs them like your other bookmarks.

Bookmark and tab data is not transmitted to the developer or any third party.

## Changes to This Policy

Any changes to this privacy policy will be posted in this repository.

## Contact

For questions or concerns, open an issue at https://github.com/rashpile/SideBarforArcUsers/issues.
