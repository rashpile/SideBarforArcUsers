import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { parseBookmarkYaml } from '../utils/bookmarkYaml';
import { PasteBookmarkYamlAction } from '../actions/pasteBookmarkYamlAction';
import type { UndoableAction } from '../actions/types';
import { runBatchOperation } from '../hooks/useBookmarks';

export interface PasteYamlDialogProps
{
  isOpen: boolean;
  targetFolderId: string | null;
  onClose: () => void;
  onPerformAction?: (action: UndoableAction) => Promise<void>;
  onPasted?: () => void;
}

export const PasteYamlDialog = ({ isOpen, targetFolderId, onClose, onPerformAction, onPasted }: PasteYamlDialogProps) =>
{
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [isPasting, setIsPasting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() =>
  {
    if (isOpen)
    {
      setText('');
      setFailure(null);
      setIsPasting(false);
      // The portal mounts after this effect.
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, targetFolderId]);

  const isEmpty = text.trim() === '';
  const result = useMemo(() => (isEmpty ? null : parseBookmarkYaml(text)), [text, isEmpty]);

  if (!targetFolderId) return null;

  const handleAdd = async () =>
  {
    if (!result || !result.ok || isPasting) return;
    setIsPasting(true);
    setFailure(null);
    const action = new PasteBookmarkYamlAction(targetFolderId, result.list, chrome.bookmarks, runBatchOperation);
    if (onPerformAction)
    {
      await onPerformAction(action);
    }
    else
    {
      try
      {
        await action.do();
      }
      catch
      {
        // action.failure carries the message.
      }
    }
    setIsPasting(false);
    // performAction swallows errors from do(), so the action is the only place the failure shows up.
    if (action.failure)
    {
      setFailure(action.failure);
      return;
    }
    onPasted?.();
    onClose();
  };

  const canAdd = result !== null && result.ok && !isPasting;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Paste from YAML" maxWidth="max-w-md">
      <div className="p-4 space-y-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) =>
          {
            setText(event.target.value);
            setFailure(null);
          }}
          rows={12}
          spellCheck={false}
          placeholder={'- folder: "Tools"\n  items:\n    - title: "GitHub"\n      url: "https://github.com"'}
          className="w-full px-2 py-1.5 border rounded resize-y font-mono dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
        />

        {result && result.ok && (
          <p className="text-gray-600 dark:text-gray-300">Will create {result.list.summary()}</p>
        )}
        {result && !result.ok && (
          <ul className="space-y-0.5 text-red-600 dark:text-red-400">
            {result.errors.map((error, index) => (
              <li key={index}>{error.toString()}</li>
            ))}
          </ul>
        )}
        {failure && (
          <p className="text-red-600 dark:text-red-400">{failure}</p>
        )}

        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-md"
          >
            Add
          </button>
        </div>
      </div>
    </Dialog>
  );
};
