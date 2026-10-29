// Collapse state of the sidebar's Bookmarks and Archive sections.
// Kept per Space and shared by every window through chrome.storage.local
// (useSectionCollapseState); only the sidebar reads and writes it.

export type CollapsibleSection = 'bookmarks' | 'archive';

/** Toggles one section of one Space and persists the result. */
export type ToggleSection = (spaceId: string, section: CollapsibleSection) => void;

type SpaceSectionsCollapsed = Record<CollapsibleSection, boolean>;

/** Stored form (as a JSON string): spaceId → collapsed flag per section. */
type SectionCollapseRecord = Record<string, Partial<SpaceSectionsCollapsed> | undefined>;

// A section without a stored flag: Bookmarks expanded, Archive collapsed
const DEFAULT_COLLAPSED: SpaceSectionsCollapsed = {
  bookmarks: false,
  archive: true,
};

/** Immutable view of the stored collapse flags; a change returns a new instance. */
export class SectionCollapseState
{
  static readonly EMPTY = new SectionCollapseState({});

  /** Every section expanded: what the sidebar shows while the toolbar text filter is active. */
  static readonly ALL_EXPANDED = new SectionCollapseState({}, { bookmarks: false, archive: false });

  #record: SectionCollapseRecord;
  #defaults: SpaceSectionsCollapsed;

  constructor(record: SectionCollapseRecord, defaults: SpaceSectionsCollapsed = DEFAULT_COLLAPSED)
  {
    this.#record = record;
    this.#defaults = defaults;
  }

  /** Parses the stored JSON; anything but an object reads as empty. Throws on invalid JSON. */
  static fromJson(value: string): SectionCollapseState
  {
    const parsed: unknown = JSON.parse(value);
    const isRecord = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    return isRecord ? new SectionCollapseState(parsed as SectionCollapseRecord) : SectionCollapseState.EMPTY;
  }

  toJson(): string
  {
    return JSON.stringify(this.#record);
  }

  /** The stored flag; a missing or malformed one falls back to the section's default. */
  isCollapsed(spaceId: string, section: CollapsibleSection): boolean
  {
    const flag: unknown = this.#record[spaceId]?.[section];
    return typeof flag === 'boolean' ? flag : this.#defaults[section];
  }

  /** The state with one section of one Space flipped; the Space's entry is stored with both flags. */
  toggled(spaceId: string, section: CollapsibleSection): SectionCollapseState
  {
    const spaceFlags: SpaceSectionsCollapsed = {
      bookmarks: this.isCollapsed(spaceId, 'bookmarks'),
      archive: this.isCollapsed(spaceId, 'archive'),
    };
    spaceFlags[section] = !spaceFlags[section];
    return new SectionCollapseState({ ...this.#record, [spaceId]: spaceFlags }, this.#defaults);
  }
}
