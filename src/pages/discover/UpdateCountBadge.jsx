import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { UPDATE_TAG } from '../../services/discover';

/** Compact popover for secondary updates grouped beneath one game card. */
export default function UpdateCountBadge({ events = [], primary }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const leaveTimer = useRef(null);

  const extras = events.filter(event => event !== primary);

  const updatePos = useCallback(() => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const width = 192; // w-48 = 192px
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
    setPos({ top: r.bottom + 4, left });
  }, []);

  const handleMouseEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    updatePos();
    setOpen(true);
  };

  const handleMouseLeave = () => {
    leaveTimer.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  };

  useEffect(() => {
    if (!open) return undefined;
    updatePos();
    const closeIfOutside = (event) => {
      if (
        buttonRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleScroll = (event) => {
      if (popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', closeIfOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePos);

    return () => {
      document.removeEventListener('mousedown', closeIfOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  if (extras.length === 0) return null;

  return (
    <div
      className="relative pointer-events-auto inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          updatePos();
          setOpen(prev => !prev);
        }}
        aria-expanded={open}
        aria-label={`${extras.length} additional updates`}
        className="lh-label px-1 py-0.5 leading-none bg-black border border-white/40 text-white hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer"
      >
        +{extras.length}
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            zIndex: 9999,
          }}
          className="w-48 bg-black border border-white/40 text-left pointer-events-auto shadow-2xl"
        >
          <div className="lh-label text-white/60 px-2.5 py-1.5 border-b border-white/15">More updates</div>
          {extras.map((event, index) => (
            <div key={`${event.id || event.type}-${index}`} className="px-2.5 py-2 border-b border-white/15 last:border-b-0">
              <div className="lh-label text-white/80 leading-snug">{event.detail || UPDATE_TAG[event.type] || 'Update'}</div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
