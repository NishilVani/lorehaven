import { useState, useRef, useEffect, useId, cloneElement } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────
// Tooltip
//
// A React Portal-based Tooltip component that anchors to the viewport location
// of its child, preventing any overflow-hidden clipping from parent components.
// ─────────────────────────────────────────────
/* Standalone for the same reason setInert is, over in useFocusTrap.js: inside the
   component the compiler reads `ref.current = node` as mutating a value reached
   through props. Merging a forwarded ref with our own is the entire job of a ref
   callback, and a DOM node is not React state. */
const assignRef = (ref, node) => {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
};

export function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const closeTimer = useRef(null);

  /* WCAG 1.4.13 Hoverable: leaving the trigger must not kill the tooltip instantly,
     or the 8px gap between the two can never be crossed. The close is deferred and
     cancelled if the pointer lands on the tooltip itself. */
  const show = () => { clearTimeout(closeTimer.current); setVisible(true); };
  const hide = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setVisible(false), 150); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  // Stable id so the trigger can point at the tooltip via aria-describedby.
  const tooltipId = useId();

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    }
  };

  useEffect(() => {
    if (!visible) return;

    updatePosition();

    // WCAG 1.4.13: hover/focus content must be dismissible without moving the pointer.
    const onKeyDown = (e) => { if (e.key === "Escape") setVisible(false); };

    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });
    window.addEventListener("resize", updatePosition, { passive: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("scroll", updatePosition, { capture: true });
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [visible]);

  const childRef = children.props?.ref;

  return (
    <>
      {/* eslint-disable-next-line react-hooks/refs -- cloneElement with a ref key
          is read as ref access during render, and the compiler has no way to see
          that this is a ref *callback* being handed to the child rather than a
          ref being read. The alternative is wrapping children in a span, which
          would change the DOM under every tooltip in the app; every current
          caller relies on the trigger keeping its own box. */}
      {cloneElement(children, {
        /* children.props.ref, not children.ref: the latter is the legacy element
           field, deprecated in React 19 and warned about on access. */
        ref: (node) => {
          triggerRef.current = node;
          assignRef(childRef, node);
        },
        // Appended, not assigned: a trigger that already describes itself (an error
        // message, a hint) would otherwise lose that association while hovered.
        "aria-describedby": [children.props["aria-describedby"], visible && text ? tooltipId : null]
          .filter(Boolean).join(" ") || undefined,
        onMouseEnter: (e) => {
          show();
          children.props.onMouseEnter?.(e);
        },
        onMouseLeave: (e) => {
          hide();
          children.props.onMouseLeave?.(e);
        },
        // Keyboard parity with hover (WCAG 2.1.1): without these the tooltip is
        // unreachable for anyone not using a pointer.
        onFocus: (e) => {
          show();
          children.props.onFocus?.(e);
        },
        onBlur: (e) => {
          hide();
          children.props.onBlur?.(e);
        },
      })}
      {visible && text &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            onMouseEnter={show}
            onMouseLeave={hide}
            className="platform-tooltip"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

export default Tooltip;
