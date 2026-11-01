# Privacy Policy for Side Bar for Arc Users — Arc Style

## Data Collection

This extension does not collect personal data and has no server. The developer receives nothing. The only data that leaves your device is described under External Services below. AI naming and the page agent send data only to the endpoint you configure.

## Local Storage

The extension stores the following data locally on your device using Chrome's storage API:

- Favorites' custom icons, emoji and icon colors (the Favorites themselves are Chrome bookmarks in each Space's `asd_Favorites` folder)
- Favicons (stored as base64 image data)
- User preferences (font size, icon size, display settings)
- AI naming settings, including the API key you enter, if you configure AI naming. The page agent uses the same settings
- The page agent drawer's height
- Page agent chats: your requests, the conditions, the agent's steps, its answers and the CSS it applied, one chat per tab (stored in `chrome.storage.session`, which Chrome clears when the browser closes). Closing the tab deletes its chat; if no side panel is open at that moment, the next side panel to open deletes it, or Chrome when the browser closes. Screenshots are never stored; they stay in the open side panel's memory. The answer popup on a page stores nothing; it stays in the page until you close it, reload the page or move to another page
- The URL, window, position in the window, and last-use times of each open tab, and whether you have switched to it since it was opened, recorded while "Archive tabs after", "Highlight tabs by last use" or "Mark unvisited tabs" is turned on, so the extension knows how long a tab has been unused, how recently you left it and which tabs you haven't looked at yet (stored in `chrome.storage.local`; incognito tabs are never recorded). "Highlight tabs by last use" and "Mark unvisited tabs" are on by default, so the extension records them unless you turn both off. Setting "Archive tabs after" to "Never", "Highlight tabs by last use" to "Off" and turning "Mark unvisited tabs" off deletes them
- Page styles you save to a bookmark or Favorite with the page agent's **Save to bookmark**: the CSS, the origin of the page it was saved on, such as `https://example.com`, and the Auto-apply setting, per bookmark (stored in `chrome.storage.local`). Remove in the drawer or the bookmark's Page style menu, or deleting the bookmark, deletes it
- The URL, window and position in the window of each tab you mark with "Mark for Attention", and the IDs of bookmarks you mark, so the marks survive a browser restart (stored in `chrome.storage.local`; incognito tabs can't be marked). Clearing a mark, closing the tab or deleting the bookmark deletes its entry
- The URL, title and close time of tabs you close, up to 50 per Space, for the Recently Closed list (stored in `chrome.storage.local`). Clear in the Recently Closed list or deleting the Space deletes them. Incognito tabs are never recorded
- The URL, title and Space of each open tab, so a close can be recorded after the extension's background worker has slept (stored in `chrome.storage.session`, which Chrome clears when the browser closes; incognito tabs are kept out of the Recently Closed list)

This data stays on your device and is not accessible to the developer or any third party.

## External Services

- **Iconify API**: The extension connects to `api.iconify.design` to fetch icon images when you customize Favorite icons.
- **Favicons**: The extension may fetch favicons directly from websites you pin to store them locally for faster loading.

No user data is sent in these requests beyond standard HTTP headers.

## AI Naming

AI naming is off until you enter an API endpoint in Settings. When you rename a Favorite or pinned page with AI, or turn on automatic naming:

- The extension reads the page's text, title and description from the open tab, after asking for host permission. It may also fetch the page, its Markdown version and the site's `llms.txt` without cookies; the Markdown version and pages listed in `llms.txt` only from the page's own site, without following redirects.
- It sends the page URL, title, description, up to 12,000 characters of that text and up to 3,000 characters from `llms.txt`, together with your prompt, to the endpoint you configured, using your API key. The endpoint must use HTTPS unless it runs on this computer (localhost), so the key and the page text are not sent unencrypted over the network.
- What that service does with the request is governed by its own privacy policy. The extension doesn't send this data anywhere else.

## Page Agent (experimental)

The page agent sends nothing until you type a request in its drawer. While it works on a request in a tab:

- The extension reads from that tab, after asking for host permission: its URL and title, the text of the page's main content (up to 30,000 characters) when the agent asks for it, an outline of the page's visible layout (element names, ids, classes, sizes and positions, and up to 40 characters of each element's own text), and the sizes, positions and computed styles of the elements the agent asks to inspect.
- With "Model accepts images" turned on in Settings, and after you allow access to all pages, it takes screenshots of the visible part of the tab while the tab is the active one in its window.
- It sends the page text, the outline, the inspect results, the screenshots, your requests, a summary of the tab's earlier messages with the agent's earlier answers (up to 4,000 characters each) and the CSS the agent wrote to the endpoint you configured, using your API key and without cookies.
- It changes the page only by inserting CSS into that tab and by showing the agent's answers in a popup the extension adds to the page, built from the answer's text. It doesn't run code written by the model, it rejects CSS that would load anything from the network, and the popup loads nothing: images in an answer stay text, and a link opens only when you click it.
- What that service does with the request is governed by its own privacy policy. The extension doesn't send this data anywhere else.

When you save a page style to a bookmark and leave Auto-apply on, the extension acts without a request: whenever a page of the site the style was saved on loads in that bookmark's tab, it reads a marker from the page (whether the saved style is already there) and inserts the saved CSS. It reads nothing else from the page, and nothing of this goes to the AI endpoint or anywhere else. Tabs you opened by hand and incognito tabs are left alone.

## Bookmarks and Tabs

The extension reads your Chrome bookmarks and tabs to display them in the sidebar.

When "Archive tabs after" is turned on in Settings, the extension also creates bookmarks: before it closes an unused tab, it saves the tab's title and URL as a bookmark in an `asd_Archive` folder inside the Space's bookmark folder. These are ordinary Chrome bookmarks. The extension does not send them anywhere; if Chrome Sync is on, Chrome syncs them like your other bookmarks.

Bookmark and tab data is not transmitted to the developer or any third party.

## Changes to This Policy

Any changes to this privacy policy will be posted in this repository.

## Contact

For questions or concerns, open an issue at https://github.com/rashpile/SideBarforArcUsers/issues.
