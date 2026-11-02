import { Globe, NotebookText } from 'lucide-react';
import { getFaviconUrl } from '../utils/favicon';
import { isOwnNoteUrl } from '../utils/noteUrl';

interface BookmarkFaviconProps
{
  url: string;
}

/**
 * A page's favicon from Chrome's favicon cache. When Chrome has none cached, the
 * image hides itself and the globe after it shows instead. This extension's notes
 * get a note icon, so a note row doesn't look like a page that lost its favicon.
 */
export const BookmarkFavicon = ({ url }: BookmarkFaviconProps) =>
{
  if (isOwnNoteUrl(url, location.origin))
  {
    return <NotebookText size={16} className="text-gray-500" />;
  }

  return (
    <>
      <img
        src={getFaviconUrl(url)}
        alt=""
        className="w-4 h-4"
        onError={(e) =>
        {
          e.currentTarget.style.display = 'none';
          e.currentTarget.nextElementSibling?.classList.remove('hidden');
        }}
      />
      <Globe size={16} className="hidden text-gray-500" />
    </>
  );
};
