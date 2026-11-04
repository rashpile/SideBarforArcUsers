/**
 * DropdownMenu - Left-click dropdown menu that opens below its trigger button,
 * or to its right (side="right") when the trigger sits in a vertical toolbar strip
 */
import
{
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  cloneElement,
  isValidElement,
  ReactNode,
  ReactElement,
  MouseEvent as ReactMouseEvent,
  forwardRef,
  HTMLAttributes
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useFontSize } from '../../contexts/FontSizeContext';
import { Item as BaseItem, Separator, Overlay, useEscapeKey, menuContainerClass } from './MenuBase';
import { placeSubmenu, MENU_VIEWPORT_MARGIN } from '../../utils/menuPosition';

// Re-export Separator (Item is wrapped below to add close behavior)
export { Separator };

// --- Context ---
interface DropdownMenuState
{
  isOpen: boolean;
  triggerRect: DOMRect | null;
  open: (rect: DOMRect) => void;
  close: () => void;
}

const DropdownMenuContext = createContext<DropdownMenuState | null>(null);

const useDropdownMenuState = () =>
{
  const context = useContext(DropdownMenuContext);
  if (!context)
  {
    throw new Error('DropdownMenu components must be used within DropdownMenu.Root');
  }
  return context;
};

// --- Root ---
interface RootProps
{
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;  // For external trigger positioning
}

export const Root = ({ children, open: controlledOpen, onOpenChange, anchorRef }: RootProps) =>
{
  const [internalOpen, setInternalOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  // Update triggerRect from anchorRef when opening in controlled mode
  useEffect(() =>
  {
    if (isOpen && anchorRef?.current && !triggerRect)
    {
      setTriggerRect(anchorRef.current.getBoundingClientRect());
    }
    if (!isOpen)
    {
      setTriggerRect(null);
    }
  }, [isOpen, anchorRef, triggerRect]);

  const open = useCallback((rect: DOMRect) =>
  {
    setTriggerRect(rect);
    if (isControlled)
    {
      onOpenChange?.(true);
    }
    else
    {
      setInternalOpen(true);
    }
  }, [isControlled, onOpenChange]);

  const close = useCallback(() =>
  {
    if (isControlled)
    {
      onOpenChange?.(false);
    }
    else
    {
      setInternalOpen(false);
    }
  }, [isControlled, onOpenChange]);

  return (
    <DropdownMenuContext.Provider value={{ isOpen, triggerRect, open, close }}>
      {children}
    </DropdownMenuContext.Provider>
  );
};

// --- Trigger ---
interface TriggerProps
{
  children: ReactNode;
  asChild?: boolean;
}

export const Trigger = ({ children, asChild }: TriggerProps) =>
{
  const { isOpen, open, close } = useDropdownMenuState();
  const ref = useRef<HTMLElement>(null);

  const handleClick = useCallback((e: ReactMouseEvent) =>
  {
    e.stopPropagation();
    if (isOpen)
    {
      close();
    }
    else
    {
      const element = ref.current;
      if (element)
      {
        open(element.getBoundingClientRect());
      }
    }
  }, [isOpen, open, close]);

  if (asChild && isValidElement(children))
  {
    const child = children as ReactElement<{
      onClick?: (e: ReactMouseEvent) => void;
      ref?: React.Ref<HTMLElement>;
    }>;
    const originalOnClick = child.props.onClick;

    return cloneElement(child, {
      ref: ref as React.Ref<HTMLElement>,
      onClick: (e: ReactMouseEvent) =>
      {
        handleClick(e);
        originalOnClick?.(e);
      }
    });
  }

  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      onClick={handleClick}
      type="button"
    >
      {children}
    </button>
  );
};

// --- Content ---
export type DropdownSide = 'bottom' | 'right';

interface ContentProps extends HTMLAttributes<HTMLDivElement>
{
  children: ReactNode;
  align?: 'start' | 'end';  // align to left or right edge of trigger; ignored for side="right"
  side?: DropdownSide;
}

export const Content = forwardRef<HTMLDivElement, ContentProps>(
  ({ children, className, align = 'start', side = 'bottom', style, ...props }, ref) =>
  {
    const { isOpen, triggerRect, close } = useDropdownMenuState();
    const fontSize = useFontSize();
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = useState({ x: 0, y: 0, maxHeight: 400 });

    // Use shared escape key handler
    useEscapeKey(isOpen, close);

    // Position below trigger (or above if space is tight) or to its right, compute max-height to enable scrolling
    useEffect(() =>
    {
      if (!isOpen || !triggerRect || !menuRef.current) return;

      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (side === 'right')
      {
        // The previous opening's maxHeight (400 at first) is still applied and can clip
        // rect.height, so measure the whole list; the borders count too, since max-height
        // includes them (border-box).
        const borders = menu.offsetHeight - menu.clientHeight;
        const height = Math.min(menu.scrollHeight + borders, viewportHeight - 2 * MENU_VIEWPORT_MARGIN);
        const { x, y } = placeSubmenu(
          triggerRect,
          { width: rect.width, height },
          { width: viewportWidth, height: viewportHeight }
        );
        setPosition({ x, y, maxHeight: viewportHeight - MENU_VIEWPORT_MARGIN - y });
        return;
      }

      // Horizontal position: aligned to start or end of trigger
      let x = align === 'start' ? triggerRect.left : triggerRect.right - rect.width;
      if (x + rect.width > viewportWidth) x = viewportWidth - rect.width - 8;
      if (x < 0) x = 8;

      // Available space above and below the trigger
      const spaceBelow = viewportHeight - triggerRect.bottom - 4 - 8;
      const spaceAbove = triggerRect.top - 4 - 8;

      let y: number;
      let maxHeight: number;

      if (spaceBelow >= Math.min(rect.height, 150) || spaceBelow >= spaceAbove)
      {
        // Place below trigger
        y = triggerRect.bottom + 4;
        maxHeight = spaceBelow;
      }
      else
      {
        // Flip above trigger when more space is available there
        maxHeight = spaceAbove;
        y = Math.max(8, triggerRect.top - 4 - Math.min(rect.height, maxHeight));
      }

      setPosition({ x, y, maxHeight: Math.max(maxHeight, 80) });
    }, [isOpen, triggerRect, align, side]);

    if (!isOpen) return null;

    return createPortal(
      <>
        <Overlay onClose={close} />
        <div
          ref={(node) =>
          {
            menuRef.current = node;
            if (typeof ref === 'function')
            {
              ref(node);
            }
            else if (ref)
            {
              ref.current = node;
            }
          }}
          className={clsx(menuContainerClass, "overflow-y-auto", className)}
          style={{
            left: position.x,
            top: position.y,
            maxHeight: position.maxHeight,
            fontSize: `${fontSize}px`,
            ...style
          }}
          {...props}
        >
          {children}
        </div>
      </>,
      document.body
    );
  }
);
Content.displayName = 'DropdownMenu.Content';

// --- Item (wraps BaseItem to add close behavior) ---
interface ItemProps extends HTMLAttributes<HTMLDivElement>
{
  children: ReactNode;
  danger?: boolean;
  onSelect?: () => void;
}

export const Item = forwardRef<HTMLDivElement, ItemProps>(
  ({ onSelect, ...props }, ref) =>
  {
    const { close } = useDropdownMenuState();

    const handleSelect = useCallback(() =>
    {
      onSelect?.();
      close();
    }, [onSelect, close]);

    return <BaseItem ref={ref} onSelect={handleSelect} {...props} />;
  }
);
Item.displayName = 'DropdownMenu.Item';
