/**
 * toast() — fire-and-forget notification.
 *
 * Separate from <ToastContainer> because a module that exports both a component
 * and a plain function loses fast refresh. There is no shared state to split:
 * the two halves talk over a window CustomEvent, which is also why any module
 * can call this without holding a React reference.
 */
/* `action` is an optional { label, onClick }. It exists so a mutation can offer a
   reversal in the same place it announces itself: the library's move, priority and
   rating handlers all wrote and toasted with no way back, so recovering from a
   mis-drop meant switching shelf, finding the game and moving it by hand. The
   action rides the toast's own timer, so the offer expires with the message. */
export const toast = (message, type = 'info', action = null) => {
  const event = new CustomEvent('show-toast', { detail: { message, type, action } });
  window.dispatchEvent(event);
};
