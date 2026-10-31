// The tab list's selection as seen from one row. A row's hover buttons stop propagation, so pressing one
// on an unselected row leaves the selection as it is: such a row acts on itself, not on the selection
export class TabRowSelection
{
  private readonly selectedIds: Set<string>;

  // Selection item ids: a tab's id as a string, a group's as `group-<groupId>`
  constructor(selectedIds: string[])
  {
    this.selectedIds = new Set(selectedIds);
  }

  // True when the row is part of a selection of more than one item, itself or through its selected group
  actsOnSelection(tabId: number, groupId: number | undefined): boolean
  {
    if (this.selectedIds.size <= 1) return false;
    if (this.selectedIds.has(String(tabId))) return true;
    return groupId !== undefined && groupId !== -1 && this.selectedIds.has(`group-${groupId}`);
  }
}
