// =============================================================================
// Keyboard switcher messages between background.ts and src/switcherOverlay.ts
// =============================================================================

// switcherOverlay.ts is injected as a classic script and can't import this
// file, so it repeats these strings - change both together.
export const SwitcherMessageAction = {
  SHOW: 'switcher-show',      // background -> page overlay: draw the list
  ICONS: 'switcher-icons',    // background -> page overlay: favicons as data URLs, by card id
  MOVE: 'switcher-move',      // background -> list: move the selection by `steps`
  READY: 'switcher-ready',    // switcher window -> background: send me the list
  COMMIT: 'switcher-commit',  // list -> background: switch to card `id`
  CANCEL: 'switcher-cancel',  // list -> background: closed without switching
} as const;

// One row of the list: a tab or a Space
export interface SwitcherCard
{
  id: string;                  // tab ID or Space ID, sent back on commit
  title: string;
  subtitle: string;
  // A tab's page, whose favicon the list shows. The extension's _favicon is
  // not web-accessible, so the overlay over a page gets it as a data URL (ICONS)
  faviconPageUrl?: string;
  iconUrl?: string;
  iconText?: string;           // an emoji Space icon, drawn instead of iconUrl
  invertIconInDark?: boolean;  // iconUrl is a black Lucide glyph, not a favicon
  badge?: string;
}

// What the list shows and how it is driven
export interface SwitcherListData
{
  cards: SwitcherCard[];
  steps: number;               // moves already made, counted from the first card
  repeatKeyCode?: string;      // KeyboardEvent.code of the shortcut's key
}
