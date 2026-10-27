# Side Bar for Arc Users — Arc Style

An independently maintained Chrome extension with one primary goal: make tab management in Chrome feel as close to Arc as the Chrome extension platform allows.

Arc is the product and interaction reference for this fork. Visual density, Favorites, pinned pages, Spaces, active-tab treatment, menus, persistence, and tab-group behavior are intentionally evaluated against Arc rather than treated as loosely inspired features.

Chrome still owns the browser frame, address bar, native horizontal tab strip, and Side Panel title bar, so an extension cannot reproduce those surfaces. Everything rendered inside the extension's Side Panel is designed to minimize the remaining difference.

**What it does:**
- **Arc-style sidebar:** Favorites, pinned pages, folders, and unpinned tabs in one vertical panel
- **Focused Spaces:** View one Space at a time, with no aggregate "All" Space
- **Persistent pages:** Pinned bookmark pages keep their position and reopen like Arc pinned tabs
- **Persistent Space assignment:** Tabs belong to Spaces through extension-owned state, independently of Chrome's native tab groups
- **Tab history:** Navigate back/forward through recently used tabs
- **Arc-like menus:** Single- and multi-selection actions follow Arc where Chrome APIs permit
- **Backup/Restore:** Export and import everything to JSON
- **Drag & drop:** Reorganize bookmarks, folders, tabs, and groups easily
- **Filter & search:** Find items by text, filter by live tabs or playing audio
- **Optional AI naming:** Rename Favorites and pinned bookmark pages through an OpenAI-compatible API

## Background

I've been using Arc Browser for a while. When Arc paused development, I started looking at Chrome and other Chromium-based browsers. The one thing I really missed was Arc's sidebar—how it puts favorite sites, pinned pages, and tabs all in one vertical list.

This fork continues that idea as a separate extension, with Arc parity as an explicit product direction rather than an occasional styling goal.

## Core Goal: Stay as Close to Arc as Possible

When a behavior can be implemented safely with Chrome APIs, this fork prefers Arc's behavior and terminology:

- Favorites remain available across Spaces.
- Pinned pages are backed by bookmarks so their position survives closing the live tab.
- Unpinned tabs belong to the current Space through a persistent internal assignment that survives extension reloads and browser restoration.
- Only one Space is visible at a time; the upstream aggregate `All` view is intentionally removed.
- Collapsed folders still expose their open pinned pages (the active one as a card), matching Arc's location cue. Hovering a collapsed folder shows its recently used pages with search.
- Active rows, spacing, translucency, typography, icons, bottom Space navigation, and context menus are tuned against Arc screenshots.

Platform limitations are documented rather than hidden. Features that require control over Chrome's native window chrome—such as replacing the horizontal tab strip or styling the Side Panel host header—are outside an extension's control.

## Differences from Upstream

This repository is a standalone fork of [monemone-org/ChromeSideBar](https://github.com/monemone-org/ChromeSideBar). It is maintained independently and is not intended to be merged back upstream.

The following differences describe this fork relative to the upstream version it was based on:

| Area | This fork |
| --- | --- |
| Product direction | Arc fidelity is the primary goal for interaction, terminology, layout, and visual treatment. |
| Extension identity | Uses the `Side Bar for Arc Users — Arc Style` name and is packaged as a separate extension. |
| Spaces | Removes the visible `All` Space. The sidebar, swipe navigation, and Space Navigator show one real Space at a time. Legacy `all` state migrates to the first real Space. |
| Space tab ownership | Space membership is stored independently from Chrome native tab groups. Native groups remain fully user-owned and can span tabs from different Spaces without changing their Space assignment. |
| Pinned-page persistence | Bookmark/Favorite-to-tab associations use session state plus a local recovery backup, so closing and reopening the Side Panel does not duplicate pinned pages in the Tabs section. |
| Arc-style tree behavior | Clicking a folder row expands or collapses it. A collapsed folder surfaces its open pinned descendants, with the active one as an inset card, and shows a recent-pages popover on hover. |
| Context menus | Pinned-page single and multi-selection menus follow Arc's supported actions, including `New Folder with N Items`, move, duplicate, mute, share, and remove-pin behavior. Unsupported Arc-only features such as Split View and Customize Page are deliberately omitted. |
| Visual system | Adds Arc-oriented colors, translucency, row geometry, Favorites grid, active-page cards, folder icons, spacing, and bottom Space navigation. |
| Startup performance | Shares bookmark/tab subscriptions, restores associations concurrently, lazy-loads secondary dialogs, and includes Performance Timeline marks for cold-start diagnosis. |
| AI naming | Adds optional manual or automatic naming for Favorites and bookmark-backed pinned pages through configurable OpenAI-compatible Responses or Chat Completions APIs. |

The upstream remote is retained for reference and attribution, but releases from this repository are made from this fork's own `main` branch.

## Features

### Tab History Navigation

Navigate back and forward through your recently used tabs—like undo/redo for tab switching.

- `Cmd+Shift+<` (Mac) / `Ctrl+Shift+<` (Windows/Linux): Go back to previous tab
- `Cmd+Shift+>` (Mac) / `Ctrl+Shift+>` (Windows/Linux): Go forward
- Each window maintains its own history stack
- Closed tabs are automatically removed from history

### Pinned Sites

- Quick-access icon bar at top of panel
- Pin bookmarks or tabs for one-click navigation
- Drag-and-drop to reorder
- Custom icons and colors
- Configurable icon size (12-48px)
- Right-click menu: Edit (title, URL, icon, color), Duplicate, Reset favicon, Unpin, Move to New Window (when loaded)
- Click: Open as Arc-style tab
- Cmd/Ctrl+Click: Open in new background tab, Shift+Click: Open in new window
- Open indicator: Circular dot for opened state, triangle for playing audio

### Bookmarks

- Display bookmarks and folders in a tree structure
- Context menu (...):
  - New Folder
  - Sort by Name/Date
  - Edit
  - Duplicate
  - Delete
  - Pin to pinned bar
  - Move to New Window (when loaded)
  - Expand All (folders only, recursively expands all subfolders)
- Drag-and-drop to organize bookmarks
- Drag tabs from Tabs section to create bookmarks
- Click: Open as Arc-style tab
- Cmd/Ctrl+Click: Open in new background tab, Shift+Click: Open in new window
- Audio indicator (speaker icon) for playing audio
- Close tab via X button on hover

### Active Tabs

- Display unpinned tabs that belong to the current Space
- Audio indicator (speaker icon) for tabs playing audio
- Follow Chrome's active tab and switch Spaces according to the configured follow mode
- Reorder tabs via drag-and-drop
- Click to switch to tab
- Close tab via X button on hover
- "New Tab" row at the bottom for quick tab creation
- Tab context menu (right-click):
  - Pin to Sidebar
  - Add to Group
  - Add to Bookmark (or "Move to Bookmark" in Arc style mode)
  - Move to New Window
  - Duplicate
  - Close
  - Close Tabs Before / After / Other Tabs
- Sort options (via header menu):
  - Sort by domain then title (A-Z or Z-A)
  - Close all tabs
- Tab Group support:
  - Display Chrome tab groups with their color and title
  - Collapse/expand groups by clicking the group header
  - Group context menu:
    - New Tab (in group)
    - Sort by Domain (A-Z or Z-A)
    - Save to Bookmarks (creates a bookmark folder with all tabs)
    - Rename Group
    - Change Color
    - Close All Tabs in Group
  - Drag-and-drop support:
    - Reorder tabs within a group
    - Move tabs between groups
    - Move tabs in/out of groups
    - Reorder tab groups
    - Drag tab groups to Bookmarks section to save as folder

### Spaces

Organize your browsing by context with Arc-style Spaces—isolated workspaces that filter the sidebar to show only relevant bookmarks and tabs.

- **What is a Space?** A Space links a bookmark folder with a persistent set of real Chrome tabs, plus a name, icon, and color
- **One Space at a time**: There is no aggregate `All` Space; the sidebar always shows one real Space
- **Legacy migration**: Older `all` or deleted Space state automatically resolves to the first available real Space
- **SpaceBar**: Horizontal row of space icons at the bottom of the panel
  - Click to switch spaces
  - Active Space uses Arc-style visual treatment
  - Swipe left/right to switch spaces
- **Creating Spaces**:
  - Click "+" in the SpaceBar
  - Pick a name, icon, color, and bookmark folder
  - Folder auto-creates if it doesn't exist
- **Filtering**:
  - Active Space shows only its bookmark folder and internally assigned tabs
  - New tabs (Cmd+T) automatically belong to the active Space without being placed in a native group
  - Legacy tabs are migrated from prior extension state and existing Space-named groups once
  - Tab operations (Close All, Sort) only affect the current space's tabs
- **Chrome Tab Group Independence**:
  - Native Chrome groups remain available as ordinary user-created groups inside each Space
  - Moving, renaming, or deleting a native group does not change Space membership
  - Upgrading from the older group-backed model ungroups only groups explicitly recorded as extension-owned; no tabs are closed
  - Historical closed Saved Tab Group shortcuts must be removed once through Chrome because Chrome exposes no extension API for deleting them
- **Context menu** (right-click space icon):
  - Edit (name, icon, color, bookmark folder)
  - Delete (with confirmation)
- **Last Space protection**: The final remaining Space cannot be deleted; use `+` to create additional Spaces
- **Multi-window**: Each real Tab keeps its own Space assignment when moved between windows
- **One folder, one Space**: a bookmark folder is assumed to belong to at most one Space. Picking the same folder for two Spaces is not blocked, but is unsupported - the extension resolves a bookmark to its Space by folder, so a shared folder resolves to whichever Space is found first.

### Import & Export

- Full backup and restore capability via JSON files
- Export options:
  - Select specific data to export: Pinned sites, Bookmarks, and/or Tabs & Groups
- Import options:
  - **Pinned Sites**: Replace existing or append to list
  - **Bookmarks**: Replace all or import as a subfolder
  - **Tabs & Groups**: Replace current session or append to current window

### Filter & Search

Toolbar at the top with filter options:

- **Text search bar**: Search by title or URL across pinned sites, bookmarks, and tabs
  - Dropdown shows saved and recent filters (last 5 used)
  - Save button to persist current filter
- **Search bar toggle**: Show/hide the text search bar (hidden by default)
- **Live tabs filter**: Show only bookmarks/pins that have an open tab
- **Audible filter**: Show only items playing audio/video
- **Reset button**: Clears all active filters

### Settings

Gear icon in the bottom-left corner:

- **Font size**: 6-36px (default: 14px)
- **Pinned icon size**: 12-48px (default: 22px)
- **Open bookmark**: Choose how bookmarks open
  - Arc style: Bookmarks act as persistent tabs (hidden from Tabs section)
    - Associations are stored in session state and recovered from a local backup when matching real tabs still exist.
  - In new tab: Opens bookmark in a new background tab
  - In active tab: Replaces the current tab with the bookmark
- **Follow active tab**: Switch Space, switch and scroll, or keep the sidebar fixed
- **Space color**: Optionally tint the sidebar with the active Space color
- **AI naming**: Configure an OpenAI-compatible endpoint, model, protocol, prompt, and automatic naming behavior

### General

- Dark/light mode (follows your system preference)
- Keyboard shortcuts:
  - `Cmd+Shift+E` (Mac) / `Ctrl+Shift+E` (Windows/Linux): Open the sidebar
  - `Cmd+Shift+<` / `Cmd+Shift+>`: Navigate tab history
  - `Alt+Shift+F`: Toggle saved filters dropdown
  - Customize shortcuts via `chrome://extensions/shortcuts`

### Permissions

- `sidePanel`, `bookmarks`, `tabs`, `tabGroups`: Core features
- `storage`: Save your settings locally
- `favicon`: Show website icons
- `scripting`: Read page content only when requested for AI-assisted naming
- Optional `http://*/*` and `https://*/*` host access: Requested explicitly for page reading or the configured AI endpoint

## Full Changelog

[docs/changelog.md](docs/changelog.md)

## Tech Stack

Built with the usual modern web stack:

- [React](https://react.dev/) (v18) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) for builds
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Lucide React](https://lucide.dev/) for icons
- [@dnd-kit/core](https://dndkit.com/) for drag & drop
- Chrome Manifest V3 APIs (`sidePanel`, `bookmarks`, `tabs`, `tabGroups`, `storage`, `favicon`)

## Project Structure

```
/
├── docs/           # Feature documentation
├── public/         # Chrome extension manifest, service worker, icons
├── src/
│   ├── components/ # React UI components (tabs, bookmarks, pinned bar, dialogs)
│   ├── hooks/      # Custom hooks wrapping Chrome APIs and shared state
│   ├── contexts/   # React contexts for global state (font size, bookmark-tab associations)
│   └── utils/      # Helper functions (drag-drop)
```

## Documentation

- `docs/chrome-web-store-info.md` - Chrome Web Store listing (summary, description, key features, change logs)
- `docs/features/` - Feature specs
- `docs/state-reference.md` - Extension state reference


## Setup & Build

### Prerequisites
- Node.js (v18+)
- npm

### Installation
```bash
npm install
```

### Build
```bash
npm run build
npm run build:debug
```
Outputs production build to `dist/` folder.

## Load in Chrome

1. Go to `chrome://extensions/`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. Click the extension icon or hit `Cmd+Shift+E` to open the sidebar

## Upstream and Attribution

This fork is based on [monemone-org/ChromeSideBar](https://github.com/monemone-org/ChromeSideBar). Thanks to the upstream project for the original extension architecture and feature foundation.

Install this fork from a release produced by this repository, or build it locally using the instructions above. The upstream Chrome Web Store listing installs the upstream extension, not this Arc-focused fork.
