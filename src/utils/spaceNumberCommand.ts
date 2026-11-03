import type { SpaceIdentity } from './spaceSelection.ts';

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

  // Undefined for the window's active Space: the Space bar does nothing for a click on it
  spaceToOpen<T extends SpaceIdentity>(spaces: readonly T[], activeSpaceId: string | null): T | undefined
  {
    const space = spaces[this.#position - 1];
    if (!space || space.id === activeSpaceId)
    {
      return undefined;
    }
    return space;
  }
}
