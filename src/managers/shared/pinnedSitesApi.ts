// The Favorite type the UI works with, and the legacy storage key.
//
// It lives outside hooks/usePinnedSites.ts because background.ts and the
// migration need it, and the service worker must not import a React hook
// module. The hook re-exports the type.

export interface PinnedSite
{
  id: string;
  url: string;
  title: string;
  favicon?: string;
  customIconName?: string;  // Lucide icon name when using custom icon
  iconColor?: string;       // Custom icon color (hex, e.g., "#ef4444")
  emoji?: string;           // Emoji character (e.g., "😀")
}

// The global Favorites list from before per-Space Favorites. Read once by the
// favorites migration, never written again.
export const PINNED_SITES_STORAGE_KEY = 'pinnedSites';
