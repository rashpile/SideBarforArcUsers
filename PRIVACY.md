# Privacy Policy for Side Bar for Arc Users — Arc Style

## Data Collection

This extension does not collect personal data and has no server. The developer receives nothing. The only data that leaves your device is described under External Services below, and AI naming sends data only to the endpoint you configure.

## Local Storage

The extension stores the following data locally on your device using Chrome's storage API:

- Favorites' custom icons, emoji and icon colors (the Favorites themselves are Chrome bookmarks in each Space's `asd_Favorites` folder)
- Favicons (stored as base64 image data)
- User preferences (font size, icon size, display settings)
- AI naming settings, including the API key you enter, if you configure AI naming
- The URL, window, position in the window, and last-use times of each open tab, and whether you have switched to it since it was opened, recorded while "Archive tabs after", "Highlight tabs by last use" or "Mark unvisited tabs" is turned on, so the extension knows how long a tab has been unused, how recently you left it and which tabs you haven't looked at yet (stored in `chrome.storage.local`; incognito tabs are never recorded). "Highlight tabs by last use" and "Mark unvisited tabs" are on by default, so the extension records them unless you turn both off. Setting "Archive tabs after" to "Never", "Highlight tabs by last use" to "Off" and turning "Mark unvisited tabs" off deletes them
- The URL, window and position in the window of each tab you mark with "Mark for Attention", and the IDs of bookmarks you mark, so the marks survive a browser restart (stored in `chrome.storage.local`; incognito tabs can't be marked). Clearing a mark, closing the tab or deleting the bookmark deletes its entry

This data stays on your device and is not accessible to the developer or any third party.

## External Services

- **Iconify API**: The extension connects to `api.iconify.design` to fetch icon images when you customize Favorite icons.
- **Favicons**: The extension may fetch favicons directly from websites you pin to store them locally for faster loading.

No user data is sent in these requests beyond standard HTTP headers.

## AI Naming

AI naming is off until you enter an API endpoint in Settings. When you rename a Favorite or pinned page with AI, or turn on automatic naming:

- The extension reads the page's text, title and description from the open tab, after asking for host permission. It may also fetch the page and the site's `llms.txt` without cookies.
- It sends the page URL, title, description, up to 12,000 characters of that text and up to 3,000 characters from `llms.txt`, together with your prompt, to the endpoint you configured, using your API key.
- What that service does with the request is governed by its own privacy policy. The extension doesn't send this data anywhere else.

## Bookmarks and Tabs

The extension reads your Chrome bookmarks and tabs to display them in the sidebar.

When "Archive tabs after" is turned on in Settings, the extension also creates bookmarks: before it closes an unused tab, it saves the tab's title and URL as a bookmark in an `asd_Archive` folder inside the Space's bookmark folder. These are ordinary Chrome bookmarks. The extension does not send them anywhere; if Chrome Sync is on, Chrome syncs them like your other bookmarks.

Bookmark and tab data is not transmitted to the developer or any third party.

## Changes to This Policy

Any changes to this privacy policy will be posted in this repository.

## Contact

For questions or concerns, open an issue at https://github.com/rashpile/SideBarforArcUsers/issues.
