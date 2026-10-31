/**
 * ContextMenu - Right-click context menu that positions at cursor
 */
import
{
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  cloneElement,
  isValidElement,
  ReactNode,
  ReactElement,
  MouseEvent as ReactMouseEvent,
  forwardRef,
  HTMLAttributes,
  MutableRefObject
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useFontSize } from '../../contexts/FontSizeContext';
import { Item as BaseItem, Separator, Overlay, useEscapeKey, menuContainerClass } from './MenuBase';
import { placeMenuAtAnchor, placeMenuAtPoint, placeSubmenu, MenuAnchorRect, MenuPoint } from '../../utils/menuPosition';
import { SubmenuHoverTimer } from '../../utils/submenuHoverTimer';

// Re-export Separator (Item is wrapped below to add close behavior)
export { Separator };

// --- Context ---
interface ContextMenuState
{
  isOpen: boolean;
  position: { x: number; y: number };
  anchorRect: MenuAnchorRect | null;
  open: (x: number, y: number) => void;
  openAtAnchor: (anchorRect: MenuAnchorRect) => void;
  close: () => void;
}

const ContextMenuContext = createContext<ContextMenuState | null>(null);

const useContextMenuState = () =>
{
  const context = useContext(ContextMenuContext);
  if (!context)
  {
    throw new Error('ContextMenu components must be used within ContextMenu.Root');
  }
  return context;
};

// --- Root ---
interface RootRenderProps
{
  isOpen: boolean;
  open: (x: number, y: number) => void;
  // For a menu opened by a button: placed below or above the button, never over it
  openAtAnchor: (anchorRect: MenuAnchorRect) => void;
  close: () => void;
}

interface RootProps
{
  children: ReactNode | ((props: RootRenderProps) => ReactNode);
}

export const Root = ({ children }: RootProps) =>
{
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [anchorRect, setAnchorRect] = useState<MenuAnchorRect | null>(null);

  const open = useCallback((x: number, y: number) =>
  {
    setPosition({ x, y });
    setAnchorRect(null);
    setIsOpen(true);
  }, []);

  const openAtAnchor = useCallback((rect: MenuAnchorRect) =>
  {
    setPosition({ x: rect.right, y: rect.bottom });
    setAnchorRect({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    setIsOpen(true);
  }, []);

  const close = useCallback(() =>
  {
    setIsOpen(false);
  }, []);

  const renderProps: RootRenderProps = { isOpen, open, openAtAnchor, close };

  return (
    <ContextMenuContext.Provider value={{ isOpen, position, anchorRect, open, openAtAnchor, close }}>
      {typeof children === 'function' ? children(renderProps) : children}
    </ContextMenuContext.Provider>
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
  const { open } = useContextMenuState();

  const handleContextMenu = (e: ReactMouseEvent) =>
  {
    e.preventDefault();
    // Focus window first to ensure events work (Chrome extension sidebar fix)
    window.focus();
    open(e.clientX, e.clientY);
  };

  if (asChild && isValidElement(children))
  {
    // Clone the child and add onContextMenu handler
    const child = children as ReactElement<{ onContextMenu?: (e: ReactMouseEvent) => void }>;
    const originalOnContextMenu = child.props.onContextMenu;

    return cloneElement(child, {
      onContextMenu: (e: ReactMouseEvent) =>
      {
        handleContextMenu(e);
        originalOnContextMenu?.(e);
      }
    });
  }

  return (
    <span onContextMenu={handleContextMenu}>
      {children}
    </span>
  );
};

// --- Portal ---
interface PortalProps
{
  children: ReactNode;
}

export const Portal = ({ children }: PortalProps) =>
{
  const { isOpen } = useContextMenuState();

  if (!isOpen) return null;

  return createPortal(children, document.body);
};

// --- Content ---
interface ContentProps extends HTMLAttributes<HTMLDivElement>
{
  children: ReactNode;
}

export const Content = forwardRef<HTMLDivElement, ContentProps>(
  ({ children, className, style, ...props }, ref) =>
  {
    const { isOpen, position, anchorRect, close } = useContextMenuState();
    const fontSize = useFontSize();
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Use shared escape key handler
    useEscapeKey(isOpen, close);

    // Adjust position to keep menu within viewport
    const [adjustedPosition, setAdjustedPosition] = useState(position);

    useEffect(() =>
    {
      if (!isOpen || !menuRef.current) return;

      const rect = menuRef.current.getBoundingClientRect();
      const size = { width: rect.width, height: rect.height };
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setAdjustedPosition(anchorRect
        ? placeMenuAtAnchor(anchorRect, size, viewport)
        : placeMenuAtPoint(position, size, viewport));
    }, [isOpen, position, anchorRect]);

    if (!isOpen) return null;

    return (
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
          className={clsx(menuContainerClass, className)}
          style={{
            left: adjustedPosition.x,
            top: adjustedPosition.y,
            fontSize: `${fontSize}px`,
            ...style
          }}
          {...props}
        >
          {children}
        </div>
      </>
    );
  }
);
Content.displayName = 'ContextMenu.Content';

// --- Item (wraps BaseItem to add close behavior) ---
interface ItemProps extends HTMLAttributes<HTMLDivElement>
{
  children: ReactNode;
  danger?: boolean;
  // BaseItem skips onSelect when disabled, so a disabled item never closes the menu.
  disabled?: boolean;
  onSelect?: () => void;
}

export const Item = forwardRef<HTMLDivElement, ItemProps>(
  ({ onSelect, ...props }, ref) =>
  {
    const { close } = useContextMenuState();

    const handleSelect = useCallback(() =>
    {
      onSelect?.();
      close();
    }, [onSelect, close]);

    return <BaseItem ref={ref} onSelect={handleSelect} {...props} />;
  }
);
Item.displayName = 'ContextMenu.Item';

// --- Submenu ---
interface SubMenuState
{
  isOpen: boolean;
  hoverTimer: SubmenuHoverTimer;
  triggerRef: MutableRefObject<HTMLDivElement | null>;
}

const SubMenuContext = createContext<SubMenuState | null>(null);

const useSubMenuState = () =>
{
  const context = useContext(SubMenuContext);
  if (!context)
  {
    throw new Error('ContextMenu.SubTrigger and SubContent must be used within ContextMenu.Sub');
  }
  return context;
};

interface SubProps
{
  children: ReactNode;
}

export const Sub = ({ children }: SubProps) =>
{
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const [hoverTimer] = useState(() => new SubmenuHoverTimer(setIsOpen, {
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number)
  }));

  // The root menu unmounts its content on close; a pending timer must not
  // fire into an unmounted Sub.
  useEffect(() => () => hoverTimer.cancelPending(), [hoverTimer]);

  return (
    <SubMenuContext.Provider value={{ isOpen, hoverTimer, triggerRef }}>
      {children}
    </SubMenuContext.Provider>
  );
};

// onSelect is taken: choosing the trigger opens the submenu.
interface SubTriggerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'>
{
  children: ReactNode;
}

export const SubTrigger = ({ children, className, onMouseEnter, onMouseLeave, ...props }: SubTriggerProps) =>
{
  const { isOpen, hoverTimer, triggerRef } = useSubMenuState();

  return (
    <BaseItem
      ref={triggerRef}
      // Opens the submenu at once and leaves the root menu open, unlike ContextMenu.Item.
      onSelect={() => hoverTimer.openNow()}
      onMouseEnter={(e) =>
      {
        hoverTimer.pointerEnteredTrigger();
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) =>
      {
        hoverTimer.pointerLeft();
        onMouseLeave?.(e);
      }}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      className={clsx(isOpen && 'bg-gray-100 dark:bg-gray-700', className)}
      {...props}
    >
      {children}
      <ChevronRight size={14} className="ml-auto pl-1 shrink-0" />
    </BaseItem>
  );
};
SubTrigger.displayName = 'ContextMenu.SubTrigger';

interface SubContentProps extends HTMLAttributes<HTMLDivElement>
{
  children: ReactNode;
}

// Rendered inside Content's fixed box, without a portal: Content has no
// transform or filter, so this fixed panel is placed against the viewport and
// stacks above the root menu's rows. Children are ContextMenu.Items, which close
// the whole menu through the root context.
export const SubContent = (props: SubContentProps) =>
{
  const { isOpen } = useSubMenuState();

  // Mounted only while open, so every opening measures and places afresh.
  if (!isOpen) return null;

  return <SubPanel {...props} />;
};
SubContent.displayName = 'ContextMenu.SubContent';

const SubPanel = ({ children, className, style, onMouseEnter, onMouseLeave, ...props }: SubContentProps) =>
{
  const { hoverTimer, triggerRef } = useSubMenuState();
  const fontSize = useFontSize();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuPoint | null>(null);

  // Measured hidden at 0,0 first, then placed before paint, so the panel never
  // shows at a spot where it covers the trigger row.
  useLayoutEffect(() =>
  {
    if (!panelRef.current || !triggerRef.current) return;

    const panelRect = panelRef.current.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    setPosition(placeSubmenu(
      { left: triggerRect.left, right: triggerRect.right, top: triggerRect.top, bottom: triggerRect.bottom },
      { width: panelRect.width, height: panelRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    ));
  }, [triggerRef]);

  return (
    <div
      ref={panelRef}
      role="menu"
      className={clsx(menuContainerClass, 'whitespace-nowrap', className)}
      style={{
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        visibility: position ? 'visible' : 'hidden',
        fontSize: `${fontSize}px`,
        ...style
      }}
      onMouseEnter={(e) =>
      {
        hoverTimer.pointerEnteredPanel();
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) =>
      {
        hoverTimer.pointerLeft();
        onMouseLeave?.(e);
      }}
      {...props}
    >
      {children}
    </div>
  );
};
