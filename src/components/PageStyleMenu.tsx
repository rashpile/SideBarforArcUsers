import { Check, Paintbrush, Trash } from 'lucide-react';
import clsx from 'clsx';
import * as ContextMenu from './menu/ContextMenu';
import type { PageStyleState } from '../hooks/usePageStyles';

interface PageStyleBadgeProps
{
  state: 'on' | 'off';
  className?: string;
}

/** The brush a bookmark row shows when the page agent's CSS is saved to the bookmark. */
export const PageStyleBadge = ({ state, className }: PageStyleBadgeProps) =>
{
  const title = state === 'on' ? 'Saved page style · auto-apply on' : 'Saved page style · auto-apply off';
  return (
    <span className={clsx('flex items-center', className)} title={title} aria-label={title}>
      <Paintbrush size={13} className={state === 'on' ? 'text-blue-500' : 'text-gray-400'} />
    </span>
  );
};

interface PageStyleSubmenuProps
{
  state: PageStyleState;
  onSetAutoApply: (on: boolean) => void;
  onRemove: () => void;
}

/**
 * The Page style submenu of a bookmark or Favorite with a saved style; nothing without one. Both
 * items change only later page loads: the open page keeps its look until a reload or the drawer's Undo.
 */
export const PageStyleSubmenu = ({ state, onSetAutoApply, onRemove }: PageStyleSubmenuProps) =>
{
  if (state === 'none') return null;

  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger>
        <Paintbrush size={14} className="mr-2" /> Page style
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent>
        <ContextMenu.Item onSelect={() => onSetAutoApply(state !== 'on')}>
          {state === 'on' ? <Check size={14} className="mr-2" /> : <span className="w-[14px] mr-2" />}
          Auto-apply on load
        </ContextMenu.Item>
        <ContextMenu.Item danger onSelect={onRemove}>
          <Trash size={14} className="mr-2" /> Remove saved style
        </ContextMenu.Item>
      </ContextMenu.SubContent>
    </ContextMenu.Sub>
  );
};
