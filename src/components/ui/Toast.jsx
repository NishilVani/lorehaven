import { useState, useEffect, useRef, useCallback } from 'react';
import useSwipe from '../../hooks/useSwipe';
import { createPortal } from 'react-dom';

/* 2s was not enough time to read a toast, let alone for a screen reader to finish
   speaking it (WCAG 2.2.1 Timing Adjustable). Six seconds, and the countdown pauses
   whenever the toast is hovered or holds focus, so the dismiss button is reachable. */
const TOAST_MS = 6000;
const MAX_VISIBLE_TOASTS = 3;

export const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleShowToast = (e) => {
      const id = Date.now() + Math.random();
      /* Capped, and the oldest goes first. Toasts live 6s and stacked without
         limit, so moving three games in quick succession built a column that
         reached the toolbar and covered the search control. Three is what fits
         above the fold beside the sticky strip. */
      setToasts((prev) => [...prev, { id, message: e.detail.message, type: e.detail.type, action: e.detail.action }]
        .slice(-MAX_VISIBLE_TOASTS));
    };
    window.addEventListener('show-toast', handleShowToast);
    return () => window.removeEventListener('show-toast', handleShowToast);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return createPortal(
    /* WCAG 4.1.3: toasts are the app's only status channel, so the region must
       announce without stealing focus. Live region lives on the container (which
       is always mounted) rather than on each toast, so insertions are announced.
       aria-atomic is deliberately off — with it on, adding a second toast re-reads
       every toast still on screen.

       Portalled to <body> so it sits OUTSIDE #root. A dialog inerts everything
       around itself but must skip live regions, and while this lived inside #root
       that skip matched the entire app subtree — so nothing was inerted at all and
       the navbar went on swallowing backdrop clicks. */
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 flex flex-col-reverse gap-3 pointer-events-none"
      /* Bottom-right, one anchor. Top-anchored, the toast sat on the header's
         action buttons at desktop and covered the back link and half the h1 at
         375; three phases specified three different top offsets, one of them an
         undefined custom property. Nothing lives in the bottom-right corner on
         any route; flex-col-reverse keeps the newest toast nearest the edge. */
      /* 10100, the top of the app's stack: above the nav rail (9999), above the
         10000 COVER layer that full-screen overlays use, and above the menus at
         10050. A toast that a lightbox can bury is a toast nobody reads — and
         the wallpaper viewer reports every save through one. */
      style={{ zIndex: 10100 }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>,
    document.body
  );
};

const ToastItem = ({ toast, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [paused, setPaused] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const itemRef = useRef(null);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => closeRef.current(), 300); // Wait for exit animation
  }, []);

  /* Swipe to dismiss, rightward only — the same direction it arrived from.
     A toast that flies out the way it came in is the one gesture people try
     without being told, and matching entry to exit is what makes it obvious.
     Dragging the other way is damped rather than blocked, so the toast still
     answers the finger instead of feeling stuck.

     Written to the node, not through state: a toast that re-rendered on every
     pointermove would re-run its timer effect throughout the drag. */
  const draggingRef = useRef(false);
  const swallowClickRef = useRef(false);

  const paintDrag = useCallback((dx, dragging) => {
    const el = itemRef.current;
    if (!el) return;
    if (dragging !== draggingRef.current) {
      draggingRef.current = dragging;
      // Hold the countdown while a finger is on it, exactly as hover does.
      setPaused(dragging);
    }
    if (!dragging) {
      el.style.transition = 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms ease';
      el.style.transform = '';
      el.style.opacity = '';
      return;
    }
    const travel = dx > 0 ? dx : dx * 0.25;
    el.style.transition = 'none';
    el.style.transform = `translate3d(${travel}px, 0, 0)`;
    // Fades as it goes, so the outcome is legible before you let go.
    el.style.opacity = String(Math.max(0.35, 1 - Math.max(0, dx) / 220));
  }, []);

  const rawSwipe = useSwipe({
    axis: 'x',
    threshold: 45,
    onMove: paintDrag,
    onCancel: () => { swallowClickRef.current = true; },
    onSwipe: (dir) => {
      swallowClickRef.current = true;
      if (dir !== 'right') return paintDrag(0, false);   // wrong way: settle back
      const el = itemRef.current;
      if (!el) return closeRef.current();
      el.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
      el.style.transform = 'translate3d(120%, 0, 0)';
      el.style.opacity = '0';
      setTimeout(() => closeRef.current(), 200);
    },
  });

  /* Cleared as each gesture begins, so the flag can only suppress the click
     belonging to the drag that set it. */
  const swipe = {
    ...rawSwipe,
    onPointerDown: (e) => { swallowClickRef.current = false; rawSwipe.onPointerDown?.(e); },
  };

  /* The timer lives on the item, not the container, so hovering or tabbing into a
     toast can stop it. An error is never auto-dismissed — losing an error message
     on a timer leaves the user with no way to find out what went wrong. */
  const isError = toast.type === 'error';
  useEffect(() => {
    if (paused || isError) return;
    const t = setTimeout(handleClose, TOAST_MS);
    return () => clearTimeout(t);
  }, [paused, isError, handleClose]);

  return (
    <div
      /* role=alert makes an error interrupt; the container's polite region would
         otherwise queue it behind whatever is being read. */
      role={isError ? 'alert' : undefined}
      ref={itemRef}
      {...swipe}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={`
        pointer-events-auto
        relative overflow-hidden
        bg-black border border-white/20
        p-4 min-w-[280px] max-w-sm
        flex items-start justify-between
        text-white text-sm font-medium
        transition-all duration-300 ease-out
        ${isClosing ? 'opacity-0 translate-x-8' : 'animate-slide-in-right'}
      `}
    >
      <div className="mr-6 lh-label lh-multiline">
        {toast.message}
        {toast.action && (
          /* Inside the message block, not beside the dismiss control: it is part of
             what the toast is saying, and the polite live region reads it with the
             message rather than as a stray control. Closing on activation means the
             offer cannot be taken twice. */
          <button
            /* A drag that ends over this button still fires its click. Undo is
               recoverable, but firing it because someone flicked the toast away
               is a mis-action either way. */
            onClick={() => {
              if (swallowClickRef.current) { swallowClickRef.current = false; return; }
              toast.action.onClick();
              handleClose();
            }}
            className="lh-label block mt-2 text-white/70 hover:text-white underline underline-offset-4 decoration-white/30 hover:decoration-white outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer"
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        onClick={handleClose}
        aria-label="Dismiss notification"
        className="relative flex items-center justify-center text-white/60 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer"
        style={{ width: '28px', height: '28px' }}
      >
        {/* Background circle */}
        <svg aria-hidden="true" className="absolute inset-0 w-full h-full" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
          {/* Countdown ring — hidden for errors, which never expire, and paused
              alongside the timer so the two never disagree. */}
          {!isError && (
            <circle
              cx="14" cy="14" r="11"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="69.115"
              className="animate-toast-circle-progress"
              style={{
                transform: 'rotate(-90deg)',
                transformOrigin: '50% 50%',
                animationDuration: `${TOAST_MS}ms`,
                animationPlayState: paused ? 'paused' : 'running',
              }}
            />
          )}
        </svg>
        {/* Cross icon */}
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="relative z-10">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  );
};
