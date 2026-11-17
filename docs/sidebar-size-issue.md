# Side panel width: why it can't be narrower than 360 px

Chrome doesn't let you drag the side panel narrower than about 360 px. The limit comes from Chrome, not from this extension, and no extension can change it.

## Where the limit comes from

- `chrome/browser/ui/side_panel/side_panel_entry.h` defines `SidePanelEntry::kSidePanelDefaultContentWidth = 360`, commented as "The default and minimum acceptable side panel content width". ([source](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/ui/side_panel/side_panel_entry.h))
- In `chrome/browser/ui/views/side_panel/side_panel.cc`, `SidePanel::GetMinimumSize()` returns that width plus the panel's border, and `SidePanel::ClampPanelWidth()` keeps every width at or above it. Drag-resizing and width overrides both go through this clamp. ([source](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/ui/views/side_panel/side_panel.cc))
- The [`chrome.sidePanel` API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) has no width setting. `setOptions` takes only `enabled`, `path` and `tabId`, and `getLayout` reports only which side the panel is on. The per-entry width callback inside Chromium isn't exposed to extensions.

So the panel is at least 360 px of content plus a border, on any screen. On a laptop that is a large part of the window.

## Vote for the Chromium issue

The request for a narrower side panel is open in the Chromium tracker:

**https://issues.chromium.org/issues/40926440** - "Side Panel minimum width could be smaller, as it takes up almost half of the window"

If you want a narrower sidebar, please vote for it: sign in with a Google account and click the **+1** (star) button at the top of the issue. Votes are what the Chromium team sees. Please don't add "+1" comments; they notify everyone following the issue and don't count as votes.
