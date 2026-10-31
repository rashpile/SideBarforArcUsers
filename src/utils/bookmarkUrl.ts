/** Adds `https://` when the URL has no scheme; trims whitespace. */
export function normalizeBookmarkUrl(inputUrl: string): string
{
  const trimmed = inputUrl.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
