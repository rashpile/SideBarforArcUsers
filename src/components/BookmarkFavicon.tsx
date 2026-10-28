import { Globe } from 'lucide-react';
import { getFaviconUrl } from '../utils/favicon';

interface BookmarkFaviconProps
{
  url: string;
}

/**
 * A page's favicon from Chrome's favicon cache. When Chrome has none cached, the
 * image hides itself and the globe after it shows instead.
 */
export const BookmarkFavicon = ({ url }: BookmarkFaviconProps) => (
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
