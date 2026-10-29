export interface VersionDialogStateInput
{
  isLoaded: boolean;
  lastSeenVersion: string;
  currentVersion: string;
}

export interface VersionDialogState
{
  isNewInstall: boolean;
  hasVersionChanged: boolean;
}

/** Infers no install state before storage loads, so cold starts never mount Welcome by mistake. */
export function resolveVersionDialogState({
  isLoaded,
  lastSeenVersion,
  currentVersion,
}: VersionDialogStateInput): VersionDialogState
{
  if (!isLoaded)
  {
    return { isNewInstall: false, hasVersionChanged: false };
  }

  const isNewInstall = lastSeenVersion === '';
  return {
    isNewInstall,
    hasVersionChanged: !isNewInstall && lastSeenVersion !== currentVersion,
  };
}
