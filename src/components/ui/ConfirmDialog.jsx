import { useId, useRef, useState } from 'react';
import Dialog from './Dialog';

/**
 * ConfirmDialog — in-app replacement for window.confirm on destructive actions.
 *
 * Native confirm() breaks the brutalist shell, cannot be styled or themed, and gives
 * no room to say what will actually be lost. This inherits the Dialog primitive's
 * focus trap, Escape handling and focus restore.
 *
 * Follows the same shape as the Import Wizard's "Stop Fetching" modal, which already
 * set the house pattern for a destructive confirmation.
 *
 * Per CLAUDE.md, a destructive action uses the danger variant EVERYWHERE — the
 * trigger and its confirm button match, so a delete is never red in one place and
 * white in another.
 *
 * FRICTION IS TIERED. A dialog is enough for anything scoped and re-doable — one
 * collection, one game. Pass `confirmPhrase` for the actions that take everything
 * and cannot be undone; the confirm button then stays inert until the phrase is
 * typed exactly, which is the difference between a misclick and a decision.
 * Do not reach for it by default: friction on everything trains people to type
 * through it, and then it protects nothing.
 */
export default function ConfirmDialog(props) {
  /* The body is a child so it MOUNTS FRESH on every open, which resets the typed
     phrase without an effect — otherwise the phrase stays satisfied from last time
     and the second delete needs no typing at all. */
  if (!props.open) return null;
  return <ConfirmDialogBody {...props} />;
}

function ConfirmDialogBody({
  onClose,
  onConfirm,
  eyebrow,
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  confirmPhrase = null,
}) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const cancelRef = useRef(null);

  const locked = !!confirmPhrase && typed.trim() !== confirmPhrase;
  const attempt = () => { if (locked) return; onConfirm(); onClose(); };

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="confirm-dialog-title"
      describedBy={body ? 'confirm-dialog-body' : undefined}
      z={9999}
      panelClassName="w-full max-w-sm p-6"
      /* Focus lands on Cancel, never on the destructive button — a stray Enter
         while the dialog opens must not be the thing that confirms it. */
      initialFocus={cancelRef}
    >
      {eyebrow && <div className="lh-label text-white/60 mb-2">{eyebrow}</div>}
      <h3 id="confirm-dialog-title" className="lh-display text-xl text-white mb-4">{title}</h3>
      {/* Margin lives on the wrapper, not the <p>: src/index.css has an UNLAYERED
          `p { margin: 0 }`, and unlayered CSS beats Tailwind's @layer utilities
          regardless of specificity, so mb-6 on the paragraph computes to 0. */}
      {body && (
        <div className="mb-6">
          <p id="confirm-dialog-body" className="text-[11px] text-white/60 leading-relaxed">{body}</p>
        </div>
      )}

      {confirmPhrase && (
        <div className="mb-6">
          <label htmlFor={inputId} className="lh-label text-white/60 block mb-2">
            Type <span className="text-[var(--destructive)]">{confirmPhrase}</span> to confirm
          </label>
          <input
            id={inputId}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); attempt(); } }}
            autoComplete="off"
            spellCheck="false"
            className="w-full h-10 px-3 bg-black border border-white/40 focus:border-white/70 lh-label text-white outline-none transition-colors"
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          ref={cancelRef}
          onClick={onClose}
          className="flex-1 h-10 border border-white/20 lh-label text-white/60 hover:bg-white hover:text-black hover:border-white focus:bg-white focus:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer"
        >
          {cancelLabel}
        </button>
        <button
          onClick={attempt}
          /* aria-disabled, not disabled: a control that is unreachable by Tab
             gives no way to find out WHY it will not activate. It stays
             focusable and announces its state. */
          aria-disabled={locked}
          /* Locked reads as UNARMED (neutral, no hover response), not as dimmed.
             The house aria-disabled:opacity-40 would take this label to 1.95:1,
             and this is the label telling you what is about to be destroyed.
             Colour arriving is the signal that the button is now live. */
          className={`flex-1 h-10 border lh-label transition-colors focus-visible:outline-none ${
            locked
              ? 'cursor-not-allowed opacity-40 border-white/20 text-white/60'
              : destructive
                ? 'cursor-pointer border-[var(--destructive-border)] text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black focus:bg-[var(--destructive-hover)] focus:text-black focus-visible:bg-[var(--destructive-hover)] focus-visible:text-black'
                : 'cursor-pointer bg-white text-black border-white hover:bg-neutral-200 focus:bg-neutral-200 focus-visible:bg-neutral-200'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
