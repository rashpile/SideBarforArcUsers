import { useCallback } from 'react';
import { useChromeLocalStorage } from './useChromeLocalStorage';
import { SectionCollapseState, ToggleSection } from '../utils/sectionCollapseState';

// chrome.storage.local key of the Bookmarks / Archive collapse state (feature 035), a JSON string
const SECTION_COLLAPSED_STATE_KEY = 'sectionCollapsedState';

/**
 * Collapse state of every Space's sections plus a toggle that persists it.
 * Call once (in App) and pass both down, so all headers and sections agree.
 */
export function useSectionCollapseState(): [SectionCollapseState, ToggleSection]
{
  const [state, setState] = useChromeLocalStorage<SectionCollapseState>(
    SECTION_COLLAPSED_STATE_KEY,
    SectionCollapseState.EMPTY,
    { parse: (v) => SectionCollapseState.fromJson(v), serialize: (s) => s.toJson() }
  );

  const toggleSection = useCallback<ToggleSection>((spaceId, section) =>
  {
    setState(state.toggled(spaceId, section));
  }, [state, setState]);

  return [state, toggleSection];
}
