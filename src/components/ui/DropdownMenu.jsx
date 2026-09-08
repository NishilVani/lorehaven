import { useState, useEffect, useRef, useCallback, isValidElement } from 'react';
import { createPortal } from 'react-dom';
import MarqueeText from './MarqueeText';

/**
 * DropdownMenu — Contextual action menu for GameCard / any trigger.
 *
 * Props:
 *   options  [{label, icon, onClick, variant, dividerAbove}]
 *              icon: a material-symbol name, a component, or an element. The
 *              element form exists for an icon that needs props bound per row --
 *              a platform mark, say: building a component inside the caller's
 *              .map() would create a component during render.
 *              variant: 'default' | 'danger' | 'accent'
 *   align    'left' | 'right'   (default: 'right')
 */
export default function DropdownMenu({
  options = [],
  align = 'right',
  anchorRef = null,
  matchAnchorWidth = false,
  /* 196 was narrower than the app's own longest menu label. Measured: the label
     slot was 140px, "Remove from Library" needs 160 and "Recommendation Feedback"
     199, so the two rows a user least wants to misread were the only two that
     never stopped scrolling — continuous motion on the most destructive row in
     the card menu, and WCAG 2.2.2 with no way to pause it. 264 clears the widest
     interface label (255 including icon, gaps and padding) with room to spare.
     MarqueeText stays: it is still right for genuinely long USER data such as
     platform and store names in the filter menu. It was never right for labels
     the app writes itself. */
  menuWidth = 264,
  maxWidth,
  placement = 'bottom',
  fullHeight = false,
  fullWidth = false,
  closeOnSelect = true,
  onOpenChange,
  children
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({
    top: 0,
    left: 0,
    width: menuWidth,
    maxHeight: undefined,
    openUpward: false
  });
  const triggerRef = useRef(null);
  const hasBeenOpened = useRef(false);
  const menuRef = useRef(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef?.current || triggerRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vpH = window.innerHeight;
    const vpW = window.innerWidth;
    /* Rows measure 41.2px and the panel adds 8px. Under-guessing made the "it
       fits below" branch fire for a panel that did not fit, and that branch
       leaves max-height unset with overflow hidden: an unscrollable, clipped
       menu. Over-guessing only costs a scrollbar on a menu that would have fit. */
    const MENU_H_APPROX = options.length * 42 + 8;
    /* Never wider than the viewport: the 264px desktop width was 70% of a 375px screen. */
    const actualWidth = Math.min(matchAnchorWidth ? r.width : (maxWidth || menuWidth), vpW - 16);

    const spaceBelow = vpH - r.bottom - 16;
    const spaceAbove = r.top - 16;

    let top = r.bottom + 6;
    let maxHeight = undefined;
    let openUpward = false;
    let left = align === 'right' ? r.right - actualWidth : r.left;

    if (placement === 'horizontal') {
      const spaceRight = vpW - r.right - 16;
      if (spaceRight >= actualWidth) {
        left = r.right + 12;
      } else {
        left = r.left - actualWidth - 12;
      }
      top = r.top;
      if (top + MENU_H_APPROX > vpH - 16) {
        top = Math.max(16, vpH - MENU_H_APPROX - 16);
      }
      if (MENU_H_APPROX > vpH - 32) {
        maxHeight = vpH - 32;
        top = 16;
      }
    } else {
      // Check if it fits below
      if (MENU_H_APPROX <= spaceBelow) {
        top = r.bottom + 6;
      } else if (MENU_H_APPROX <= spaceAbove) {
        top = r.top - MENU_H_APPROX - 6;
        openUpward = true;
      } else {
        // Doesn't fit perfectly in either direction: Use the direction with more space,
        // applying a scrollable max-height.
        if (spaceBelow >= spaceAbove || spaceBelow >= 150) {
          top = r.bottom + 6;
          maxHeight = Math.max(120, spaceBelow);
        } else {
          maxHeight = Math.max(120, spaceAbove);
          top = r.top - maxHeight - 6;
          openUpward = true;
        }
      }
    }

    if (placement !== 'horizontal') {
      if (left + actualWidth > vpW - 16) left = vpW - actualWidth - 16;
      if (left < 16) left = 16;
    }

    setPos({ top, left, width: actualWidth, maxHeight, openUpward });
  }, [align, options.length, anchorRef, matchAnchorWidth, menuWidth, placement]);

  const toggleMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(prev => {
      const next = !prev;
      if (next) reposition();
      if (onOpenChange) onOpenChange(next);
      return next;
    });
  }, [reposition, onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const close = (e) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setOpen(false);
        if (onOpenChange) onOpenChange(false);
      }
    };
    const onKey = (e) => { 
      if (e.key === 'Escape') {
        setOpen(false);
        if (onOpenChange) onOpenChange(false);
      }
    };
    const onScroll = (e) => { 
      if (menuRef.current && menuRef.current.contains(e.target)) {
        return;
      }
      setOpen(false);
      if (onOpenChange) onOpenChange(false);
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, reposition, onOpenChange]);

  // Menu-button ARIA belongs on the focusable control, which is the caller's child
  // (usually a <button>), not on this wrapper span. Set it on the DOM node rather
  // than via cloneElement so it works for any child shape.
  useEffect(() => {
    const el = triggerRef.current?.querySelector('button, [role="button"], a[href], input, select')
      || triggerRef.current?.firstElementChild;
    if (!el) return;
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', String(open));
  }, [open, children]);

  // Move focus into the menu when it opens so arrow keys have somewhere to start,
  // and hand focus back to the trigger when it closes.
  useEffect(() => {
    if (open) {
      hasBeenOpened.current = true;
      const first = menuRef.current?.querySelector('[role="menuitem"],[role="menuitemradio"]');
      first?.focus();
      return;
    }
    /* Restore ONLY after a real close. On first mount `open` is already false and
       activeElement is <body>, so the old guard was trivially true — every card in
       a grid raced to focus its own trigger, and the winner scrolled the page down
       to itself. On a 24-card Explore feed that landed the user ~690px in, focus
       on a menu button they never touched. */
    if (!hasBeenOpened.current) return;
    hasBeenOpened.current = false;
    if (triggerRef.current?.contains(document.activeElement)) return;
    const control = triggerRef.current?.querySelector('button, [tabindex]:not([tabindex="-1"])');
    /* preventScroll, because focus() otherwise scrolls the control into view —
       and `overflow: hidden` boxes are still programmatically scrollable, they
       just have no scrollbar to scroll back with. A GameCard clips its own
       content by 2px (scrollHeight 281 against clientHeight 279), so restoring
       focus scrolled the card up by exactly that and its top border vanished
       under the clip, permanently. Nothing here needs scrolling anyway: this
       control was on screen when the menu opened, which is how it got opened. */
    if (control && document.activeElement === document.body) control.focus({ preventScroll: true });
  }, [open]);

  // APG menu keyboard model: Up/Down cycle, Home/End jump to the ends.
  const onMenuKeyDown = useCallback((e) => {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])') || [])];
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[idx < 0 || idx === items.length - 1 ? 0 : idx + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[idx <= 0 ? items.length - 1 : idx - 1].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'Tab') {
      // A menu is a single stop: Tab dismisses rather than walking the items.
      setOpen(false);
      if (onOpenChange) onOpenChange(false);
    }
  }, [onOpenChange]);

  const VARIANT_STYLES = {
    default: {
      text: 'rgba(255,255,255,0.7)',
      hover: 'rgba(255,255,255,0.08)',
      strip: '#ffffff',
    },
    danger: {
      text: 'var(--destructive)',
      hover: 'var(--destructive-wash)',
      strip: 'var(--destructive)',
    },
    accent: {
      text: '#ffffff',
      hover: 'rgba(255,255,255,0.1)',
      strip: '#ffffff',
    },
  };

  return (
    <>
      {/* Trigger wrapper. The focusable control is the caller's child (usually a
          <button>), so the menu-button ARIA goes on the child, not this span —
          putting it here would attach state to a non-focusable element. */}
      <span
        ref={triggerRef}
        onClick={toggleMenu}
        onKeyDown={(e) => {
          // Delegated from the child control. ArrowDown opens and lands on the first
          // item, per the APG menu-button pattern. reposition() must run before
          // opening or the portal renders at the stale {top:0,left:0} it started with.
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            reposition();
            setOpen(true);
            if (onOpenChange) onOpenChange(true);
          }
        }}
        className="cursor-pointer"
        style={{ display: fullWidth ? 'flex' : 'inline-flex', width: fullWidth ? '100%' : undefined, position: 'relative', zIndex: 50, pointerEvents: 'auto', height: fullHeight ? '100%' : undefined }}
      >
        {children}
      </span>

      {/* Portal menu */}
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: maxWidth ? 'max-content' : pos.width,
            maxWidth: maxWidth ? pos.width : undefined,
            maxHeight: pos.maxHeight || undefined,
            /* 10050: above the 10000 COVER layer a full-screen overlay uses
               (see scripts/verify_layers.mjs and the wallpaper lightbox). At
               9999 this menu tied with the nav rail and opened UNDERNEATH any
               overlay that had gone above it — the wallpaper lightbox's own
               options menu rendered behind the lightbox and could not be
               clicked at all. A menu belongs above whatever opened it. */
            zIndex: 10050,
            background: '#000000',
            border: '1px solid rgba(255,255,255,0.25)',
            padding: '4px',
            animation: pos.openUpward
              ? 'dm-enter-up 0.14s cubic-bezier(0.2, 0, 0, 1.1) both'
              : 'dm-enter-down 0.14s cubic-bezier(0.2, 0, 0, 1.1) both',
            transformOrigin: `${pos.openUpward ? 'bottom' : 'top'} ${align === 'right' ? 'right' : 'left'}`,
            overflowY: pos.maxHeight ? 'auto' : 'hidden',
            overflowX: 'hidden',
          }}
          className="dm-scrollContainer"
          onClick={(e) => e.stopPropagation()}
        >
          <style>{`
            @keyframes dm-enter-down {
              from { opacity: 0; transform: scale(0.92) translateY(-4px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
            @keyframes dm-enter-up {
              from { opacity: 0; transform: scale(0.92) translateY(4px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
            .dm-scrollContainer::-webkit-scrollbar {
              width: 4px;
            }
            .dm-scrollContainer::-webkit-scrollbar-track {
              background: transparent;
            }
            .dm-scrollContainer::-webkit-scrollbar-thumb {
              background: rgba(255,255,255,0.12);
              border-radius: 2px;
            }
            .dm-scrollContainer::-webkit-scrollbar-thumb:hover {
              background: rgba(255,255,255,0.25);
            }
            .dm-item {
              display: flex;
              align-items: center;
              gap: 10px;
              width: 100%;
              padding: 9px 10px;
              font-size: 11px;
              font-weight: 500;
              letter-spacing: 0.12em;
              text-transform: uppercase;
              font-family: inherit;
              cursor: pointer;
              border: none;
              background: transparent;
              text-align: left;
              transition: background 0.12s ease, color 0.12s ease;
              position: relative;
              overflow: hidden;
              white-space: nowrap;
            }
            .dm-item::before {
              content: '';
              position: absolute;
              left: 0; top: 20%; bottom: 20%;
              width: 2px;
              border-radius: 2px;
              opacity: 0;
              transition: opacity 0.15s ease;
            }
            .dm-item:hover::before { opacity: 1; }
            /* The hover highlight is applied imperatively in onMouseEnter, so without
               this arrow-key navigation produced NO visual change at all — the focused
               item looked identical to every other. */
            .dm-item:focus-visible {
              outline: 1px solid #ffffff;
              outline-offset: -1px;
              background: rgba(255,255,255,0.08);
            }
            .dm-item:focus-visible::before { opacity: 1; }
            .dm-divider {
              height: 1px;
              background: rgba(255,255,255,0.15);
              margin: 4px 0;
            }
            .dm-group-label {
              font-family: var(--sans);
              font-weight: 500;
              text-transform: uppercase;
              letter-spacing: 0.18em;
              font-size: 0.6875rem;
              line-height: 1;
              color: rgba(255,255,255,0.45);
              padding: 8px 14px 6px;
              user-select: none;
            }
          `}</style>

          {options.map((opt, i) => {
            const v = VARIANT_STYLES[opt.variant || 'default'];
            /* opt.color — a state colour (status / priority / rating). Callers have
               always passed it; nothing rendered it, so status rows in every menu
               were monochrome while priority and rating faked it with a coloured
               <div> as their icon. It tints the icon and the left strip, never the
               label: the label stays at the variant's text colour so contrast is
               unaffected, and the colour is never the only carrier of meaning. */
            const accent = opt.color || null;
            /* A separator says "these are different". It does not say WHAT they
               are. The card menu ran eleven flat rows in which four of them were
               MOVE TO x, four were NEXT UP / SOON / MAYBE / SOMEDAY and one was
               CLEAR PRIORITY — and the only way to learn that the middle block
               was a priority axis was to read the row after it. The heading
               renders whenever the group changes, so callers just tag the block. */
            const startsGroup = opt.groupLabel && opt.groupLabel !== options[i - 1]?.groupLabel;
            return (
              <div key={i}>
                {/* A `role="menu"` may only own menuitems and separators. These
                    dividers were bare divs, so every menu in the app declared a
                    structure it did not have and the grouping they draw for
                    sighted users was invisible to anyone else. */}
                {opt.dividerAbove && i > 0 && <div role="separator" className="dm-divider" />}
                {/* role="presentation" keeps it out of the accessibility tree,
                    because a `role="menu"` may only own menuitems, separators
                    and groups. Assistive tech gets the same information through
                    each row's accessible name below, which is composed from the
                    very same groupLabel — so neither audience infers the axis
                    from the row after it. */}
                {startsGroup && (
                  <div role="presentation" className="dm-group-label">{opt.groupLabel}</div>
                )}
                <button
                  /* Callers pass isActive for single-select menus (sort, filter,
                     group-by, platform). As a plain menuitem the selection was
                     conveyed only by a background wash and a colour strip, so which
                     option was active was never announced and was colour-only. */
                  role={opt.isActive === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={opt.isActive === undefined ? undefined : !!opt.isActive}
                  /* Carries the visible heading into the name, so "Soon" is
                     announced as "Set priority: Soon". Contains the visible
                     label verbatim, which WCAG 2.5.3 requires. */
                  aria-label={opt.groupLabel ? `${opt.groupLabel}: ${opt.label}` : undefined}
                  /* The roving-focus query at the top of this file has always
                     excluded `[disabled]`, but nothing ever rendered the attribute,
                     so a caller had no way to show an option that exists and cannot
                     be taken. Absence is not an explanation: a menu that simply
                     omits the rows is indistinguishable from one that forgot them. */
                  disabled={!!opt.disabled}
                  aria-disabled={opt.disabled ? true : undefined}
                  className="dm-item"
                  style={{
                    color: v.text,
                    background: opt.isActive ? v.hover : 'transparent',
                    opacity: opt.disabled ? 0.5 : 1,
                    cursor: opt.disabled ? 'default' : undefined,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (opt.disabled) return;
                    /* Capture both anchors BEFORE the action runs. The effect below restores
                       focus when the trigger merely re-renders, but an action that removes
                       the card unmounts this component too, and then nothing of ours runs:
                       focus is left on <body>, from which the move's UNDO was measured at 35
                       Tab presses away and removed from the DOM after 6.4 seconds. */
                    const wrap = triggerRef.current;
                    const menuEl = menuRef.current;
                    /* The marked container if the page names one, else the nearest ancestor
                       that outlives the trigger. Captured now: after the action there is no
                       tree left to walk up from. */
                    const fallback = wrap?.closest('[data-focus-fallback]') || null;
                    const chain = [];
                    for (let el = wrap?.parentElement; el && el !== document.body; el = el.parentElement) chain.push(el);
                    /* "Nobody useful holds focus": <body>, a node React has already
                       detached, or the menu row itself, which is about to be detached.
                       Testing only for <body> bailed one frame too early and focus then
                       fell to <body> anyway once the portal went. */
                    const adrift = () => {
                      const a = document.activeElement;
                      return !a || a === document.body || !a.isConnected || !!menuEl?.contains(a);
                    };
                    if (closeOnSelect) {
                      setOpen(false);
                      if (onOpenChange) onOpenChange(false);
                    }
                    opt.onClick?.(e);
                    /* Two more frames after the first: some actions re-render again,
                       and a restore into a node React is about to replace is undone. */
                    const restore = (tries) => requestAnimationFrame(() => {
                      if (!adrift()) return;
                      const live = wrap?.isConnected
                        ? wrap.querySelector('button, [tabindex]:not([tabindex="-1"])')
                        : null;
                      const anchor = fallback?.isConnected ? fallback : chain.find(el => el.isConnected);
                      const target = live || anchor;
                      if (target?.isConnected) {
                        /* -1 keeps it out of the tab order; it only makes the container a
                           legal focus target so the next Tab starts from here rather than
                           from the top of the document. */
                        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
                        target.focus({ preventScroll: true });
                      }
                      if (tries > 0 && adrift()) restore(tries - 1);
                    });
                    restore(2);
                  }}
                  onMouseEnter={(e) => {
                    if (opt.disabled) return;
                    e.currentTarget.style.background = v.hover;
                    e.currentTarget.querySelector('.dm-strip').style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    if (!opt.isActive) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.querySelector('.dm-strip').style.opacity = '0';
                    }
                  }}
                >
                  {/* Colored left strip */}
                  <span
                    className="dm-strip"
                    style={{
                      position: 'absolute',
                      left: 0, top: '18%', bottom: '18%',
                      width: 2,
                      borderRadius: 2,
                      background: accent || v.strip,
                      opacity: opt.isActive ? 1 : 0,
                      transition: 'opacity 0.15s ease',
                    }}
                  />
                  {/* Icon */}
                  {opt.icon && (
                    /* The strip only shows on hover/active, so a resting row carries
                       its state colour on the icon. */
                    <div style={{ color: accent || v.text, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      {/* A component or an element. The third form -- a string
                          naming a Material Symbol -- is gone with its font: five
                          rows in the search overlay were the only callers, and
                          they rendered a second icon family beside lucide SVGs in
                          the same menu, at a different stroke weight and optical
                          size, for the cost of a whole webfont on every page. */}
                      {isValidElement(opt.icon) ? opt.icon : <opt.icon className="w-4 h-4" />}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <MarqueeText text={opt.label} />
                  </div>
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
