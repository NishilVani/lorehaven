import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { nativeCall } from '../../services/native/bridge';
import { haptic } from '../../services/native/haptics';
import { toast } from '../../components/ui/toastBus';

/* Set as wallpaper, Android app only (LoreHavenPlugin.setWallpaper).
 *
 * A sheet inside the viewer, like its Info sheet, rather than a Dialog over it:
 * two live focus traps on document fight over every Tab (see Wallpapers.jsx,
 * openFromRegister). It sends the 1080p plate; Android crops it to the screen
 * the way it crops any wallpaper. No permission prompt: SET_WALLPAPER is
 * granted at install. Escape, and Android's back gesture, close this sheet
 * before the viewer: the viewer's focus trap asks first. */

const TARGETS = [
  { value: 'home', label: 'Home Screen' },
  { value: 'lock', label: 'Lock Screen' },
  { value: 'both', label: 'Both' },
];
const DONE = { home: 'Set as your home screen', lock: 'Set as your lock screen', both: 'Set as your home and lock screens' };

export default function SetWallpaperSheet({ url, gameName, onClose, surface, hairline }) {
  const [busy, setBusy] = useState(null);
  const first = useRef(null);

  useEffect(() => { first.current?.focus(); }, []);

  const set = async (target) => {
    if (busy) return;
    setBusy(target);
    try {
      await nativeCall('setWallpaper', { url, target });
      haptic('success');
      toast(DONE[target]);
      onClose();
    } catch {
      haptic('warning');
      toast('Wallpaper not set. Check your connection and try again', 'error');
      setBusy(null);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div
        role="group"
        aria-labelledby="set-wallpaper-title"
        className="relative w-full flex flex-col animate-in slide-in-from-bottom-4 motion-reduce:animate-none"
        style={{ background: surface, borderTop: `1px solid ${hairline}` }}
      >
        <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
          <div className="w-10 h-0.5 bg-white/40" />
        </div>
        <div className="px-5 pt-2 pb-5">
          <div className="lh-label text-white/60 mb-1">Set As Wallpaper</div>
          <div id="set-wallpaper-title" className="lh-display text-lg text-white mb-4 truncate">{gameName}</div>
          <div className="flex flex-col gap-2">
            {TARGETS.map((t, i) => (
              <button
                key={t.value}
                ref={i === 0 ? first : undefined}
                type="button"
                onClick={() => set(t.value)}
                disabled={!!busy}
                aria-busy={busy === t.value}
                className="tap lh-label min-h-[48px] px-4 flex items-center justify-between border border-white/20 text-white hover:border-white disabled:opacity-50 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-white"
              >
                {t.label}
                {busy === t.value && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              </button>
            ))}
            <button
              type="button"
              onClick={onClose}
              disabled={!!busy}
              className="lh-label min-h-[48px] px-4 text-white/60 hover:text-white disabled:opacity-50 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
