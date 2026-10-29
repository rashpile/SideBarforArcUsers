// Whether the background keeps the tab activity records (stores/tabActivityTracker.ts).
// Several settings read them; this module is the one place that knows which,
// so a new consumer is added here rather than in one of the feature modules.

import type { AutoArchivePeriod } from './autoArchive.ts';
import type { TabAgeHighlightStyle } from './tabAgeHighlight.ts';
import type { UnvisitedTabMarkerSetting } from './unvisitedTabMarker.ts';

/**
 * Auto-archive needs the records, and so do the highlight and the unvisited
 * tab marker. Records are dropped only when all three are off.
 */
export function isTabActivityRecording(
  period: AutoArchivePeriod,
  style: TabAgeHighlightStyle,
  marker: UnvisitedTabMarkerSetting
): boolean
{
  return period !== 'never' || style !== 'off' || marker === 'on';
}
