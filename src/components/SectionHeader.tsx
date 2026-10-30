import React, { ReactNode, useRef } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import * as ContextMenu from './menu/ContextMenu';
import { getIndentPadding } from '../utils/indent';

interface SectionHeaderProps
{
  label: string;
  icon?: ReactNode;
  menuContent: ReactNode;
  menuTitle?: string;
  fontSize?: number;  // Optional custom font size in px
  showMenuButton?: boolean;  // Show "..." button (default true). When false, use right-click for menu.
  textClassName?: string;  // Optional custom text color classes (overrides default gray)
  labelClassName?: string;  // Optional extra classes for the label span (e.g. font-bold)
  className?: string;  // Semantic class name for the visual theme
  collapsed?: boolean;  // Collapsible section: chevron before the label, right = collapsed, down = expanded
  onToggleCollapsed?: () => void;  // Row click / Enter / Space toggles the section; omit for a display-only chevron
  trailing?: ReactNode;  // Optional content between the label and the "..." button; takes the remaining width
  actions?: ReactNode;  // Optional buttons right before the "..." button
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  label,
  icon,
  menuContent,
  menuTitle = 'Options',
  fontSize,
  showMenuButton = true,
  textClassName,
  labelClassName,
  className,
  collapsed,
  onToggleCollapsed,
  trailing,
  actions,
}) =>
{
  const menuJustClosedRef = useRef(false);
  const iconSize = Math.max(fontSize ?? 14, 14);

  // Handler for menu button mousedown - detect if menu is open before it closes
  const handleMenuButtonMouseDown = (
    _e: React.MouseEvent<HTMLButtonElement>,
    isMenuOpen: boolean
  ) =>
  {
    if (isMenuOpen)
    {
      menuJustClosedRef.current = true;
    }
  };

  // Handler for menu button click
  const handleMenuButtonClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    openMenu: (x: number, y: number) => void
  ) =>
  {
    e.stopPropagation();
    // If menu was just closed by mousedown, don't reopen
    if (menuJustClosedRef.current)
    {
      menuJustClosedRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu(rect.right, rect.bottom);
  };

  // Enter/Space on the focused toggle (chevron + label) toggles the section
  const handleToggleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) =>
  {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onToggleCollapsed?.();
  };

  const defaultTextColor = 'text-gray-500 dark:text-gray-400';

  // A collapsible header toggles on a click anywhere in the row (the "..." button stops its
  // own click). For the keyboard, chevron + label are the toggle button, beside the "..."
  // button rather than around it
  const toggleButtonProps: React.HTMLAttributes<HTMLSpanElement> = onToggleCollapsed
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': !collapsed,
        onKeyDown: handleToggleKeyDown,
      }
    : {};

  // With trailing content the label keeps its natural width and never shrinks, so a narrow
  // sidebar squeezes the trailing content instead of truncating the label
  const toggleSpanLayout = trailing ? 'flex-shrink-0' : 'flex-1 min-w-0';
  const labelLayout = trailing ? '' : 'flex-1';

  // Row shared by both menu styles; menuButton is the trailing "..." button, if any
  const renderHeaderRow = (menuButton?: ReactNode) => (
    <div
      onClick={onToggleCollapsed}
      // A peek popover opened from an action anchors to the whole row, like it does to a folder row
      data-peek-anchor={actions ? '' : undefined}
      className={`arc-section-header group relative flex items-center py-1 rounded select-none outline-none border-2 border-transparent ${onToggleCollapsed ? 'cursor-pointer' : ''} ${textClassName ?? defaultTextColor} ${className ?? ''}`}
      style={{
        paddingLeft: `${getIndentPadding(0)}px`,
        paddingRight: '8px',
        ...(fontSize ? { fontSize: `${fontSize}px` } : {})
      }}
    >
      <span
        {...toggleButtonProps}
        className={`flex ${toggleSpanLayout} items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      >
        {collapsed !== undefined && (
          <span className="flex-shrink-0 mr-1 flex items-center" aria-hidden="true">
            {collapsed ? <ChevronRight size={iconSize} /> : <ChevronDown size={iconSize} />}
          </span>
        )}
        {icon && (
          <span className="flex-shrink-0 mr-1.5 flex items-center">
            {icon}
          </span>
        )}
        <span className={`arc-section-label ${labelLayout} ${labelClassName ?? ''}`}>
          {label}
        </span>
      </span>
      {trailing && (
        <div className="flex-1 min-w-0">
          {trailing}
        </div>
      )}
      {actions}
      {menuButton}
    </div>
  );

  // No menu at all: a plain row, so right-click doesn't open an empty menu
  if (!showMenuButton && !menuContent)
  {
    return renderHeaderRow();
  }

  // When showMenuButton is false, use right-click (ContextMenu.Trigger)
  if (!showMenuButton)
  {
    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          {renderHeaderRow()}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            {menuContent}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  }

  // When showMenuButton is true, use button click
  return (
    <ContextMenu.Root>
      {({ open: openMenu, isOpen: isMenuOpen }) => (
        <>
          {renderHeaderRow(
            <button
              onMouseDown={(e) => handleMenuButtonMouseDown(e, isMenuOpen)}
              onClick={(e) => handleMenuButtonClick(e, openMenu)}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              title={menuTitle}
              aria-label={menuTitle}
            >
              <MoreHorizontal size={iconSize} />
            </button>
          )}
          <ContextMenu.Portal>
            <ContextMenu.Content>
              {menuContent}
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </>
      )}
    </ContextMenu.Root>
  );
};
