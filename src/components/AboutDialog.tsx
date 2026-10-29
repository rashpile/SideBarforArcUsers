import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Dialog } from './Dialog';

const ABOUT = {
  github: 'https://github.com/rashpile/SideBarforArcUsers',
  upstream: 'https://github.com/monemone-org/ChromeSideBar',
};

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onShowWelcome?: () => void;
}

export function AboutDialog({ isOpen, onClose, onShowWelcome }: AboutDialogProps)
{
  const [version, setVersion] = useState('');

  useEffect(() =>
  {
    if (isOpen)
    {
      setVersion(chrome.runtime.getManifest().version);
    }
  }, [isOpen]);

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="About" maxWidth="max-w-xs">
      <div className="p-3 space-y-3">
        <div className="text-gray-700 dark:text-gray-300">
          <p className="font-medium">Side Bar for Arc Users — Arc Style</p>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Version {version}
          </p>
          <p className="text-gray-500 dark:text-gray-400">
            Fork of{' '}
            <a
              href={ABOUT.upstream}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              ChromeSideBar
            </a>
            {' '}by monehsieh
          </p>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
          {onShowWelcome && (
            <button
              onClick={() =>
              {
                onClose();
                onShowWelcome();
              }}
              className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              Show Welcome
            </button>
          )}
          <a
            href={ABOUT.github}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
          >
            GitHub <ExternalLink size={12} />
          </a>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
