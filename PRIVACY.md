# Privacy Policy for Sidebar for Arc Users

## Data Collection

This extension does not collect, transmit, or share any personal data.

## Local Storage

The extension stores the following data locally on your device using Chrome's storage API:

- Pinned sites (URLs, titles, custom icons)
- Favicons (stored as base64 image data)
- User preferences (font size, icon size, display settings)
- The URL, window, position in the window, and last-use times of each open tab, recorded while "Archive tabs after" or "Highlight tabs by last use" is turned on, so the extension knows how long a tab has been unused and how recently you left it (stored in `chrome.storage.local`; incognito tabs are never recorded). "Highlight tabs by last use" is on by default, so the extension records them unless you turn it off. Setting "Archive tabs after" to "Never" and "Highlight tabs by last use" to "Off" deletes them

This data never leaves your device and is not accessible to the developer or any third party.

## External Services

- **Iconify API**: The extension connects to `api.iconify.design` to fetch icon images when you customize pinned site icons.
- **Favicons**: The extension may fetch favicons directly from websites you pin to store them locally for faster loading.

No user data is sent in these requests beyond standard HTTP headers.

## Bookmarks and Tabs

The extension reads your Chrome bookmarks and tabs to display them in the sidebar.

When "Archive tabs after" is turned on in Settings, the extension also creates bookmarks: before it closes an unused tab, it saves the tab's title and URL as a bookmark in an `asd_Archive` folder inside the Space's bookmark folder. These are ordinary Chrome bookmarks. The extension does not send them anywhere; if Chrome Sync is on, Chrome syncs them like your other bookmarks.

Bookmark and tab data is not transmitted to the developer or any third party.

## Changes to This Policy

Any changes to this privacy policy will be posted in this repository.

## Contact

For questions or concerns, please open an issue on GitHub.
