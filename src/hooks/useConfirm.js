import { useCallback, useState } from 'react';

/**
 * useConfirm — a confirm step in one line, so adding friction is cheaper than
 * skipping it.
 *
 * Before this, every confirmation cost a useState, a pending-payload state, a
 * handler and a <ConfirmDialog> block, so three actions had one and the rest
 * fired straight off a menu click. Removing a game takes its status, rating,
 * priority, notes and completion date with it and there is no undo.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   ...
 *   onClick: () => confirm(
 *     { eyebrow: 'Library', title: `Remove ${game.name}?`, body: '...' },
 *     () => removeFromLibrary(game.id),
 *   )
 *   ...
 *   return (<>{page}{confirmDialog}</>);
 *
 * Returns the props object rather than rendering, so the caller decides where the
 * dialog sits in its tree — several of these pages are inside overlays with their
 * own stacking context.
 */
export default function useConfirm() {
  const [pending, setPending] = useState(null);

  const confirm = useCallback((options, onConfirm) => {
    setPending({ ...options, onConfirm });
  }, []);

  const close = useCallback(() => setPending(null), []);

  const dialogProps = {
    open: !!pending,
    onClose: close,
    onConfirm: () => pending?.onConfirm?.(),
    eyebrow: pending?.eyebrow,
    title: pending?.title ?? '',
    body: pending?.body,
    confirmLabel: pending?.confirmLabel ?? 'Remove',
    confirmPhrase: pending?.confirmPhrase ?? null,
  };

  return [confirm, dialogProps];
}
