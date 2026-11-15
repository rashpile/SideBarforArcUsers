import type { SpaceIdentity } from './spaceSelection.ts';
import { regularSpaces } from './taskSpaces.ts';

// public/manifest.json registers space-1 … space-9; anchored so space-switcher-next can't match
const SPACE_NUMBER_COMMAND = /^space-([1-9])$/;

export class SpaceNumberCommand
{
  // 1-based, as the user counts the Space bar icons
  #position: number;

  constructor(position: number)
  {
    this.#position = position;
  }

  static parse(command: string): SpaceNumberCommand | undefined
  {
    const match = SPACE_NUMBER_COMMAND.exec(command);
    if (!match)
    {
      return undefined;
    }
    return new SpaceNumberCommand(Number(match[1]));
  }

  // Undefined for the window's active Space: the Space bar does nothing for a click on it.
  // Counts regular Spaces only, as the sortable strip shows them: Task Spaces come and go from
  // the bar, and a position that shifts with them would open a different Space each time.
  spaceToOpen<T extends SpaceIdentity & { task?: unknown }>(spaces: readonly T[], activeSpaceId: string | null): T | undefined
  {
    const space = regularSpaces(spaces)[this.#position - 1];
    if (!space || space.id === activeSpaceId)
    {
      return undefined;
    }
    return space;
  }
}
