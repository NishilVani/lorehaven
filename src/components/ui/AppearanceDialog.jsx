import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import Dialog from './Dialog';
import { getPrefs, setPrefs } from '../../services/db';
import { THEMES, THEME_GROUPS, themeVars, getTheme, isPreviewTheme } from '../../constants/themes';

/* Appearance: pick the theme the whole app wears.
 *
 * A choice applies the moment it is made: setPrefs fires moctale_prefs_update,
 * src/services/theme.js repaints <html>, and this dialog repaints with it, so
 * the user sees the real thing behind the panel rather than a thumbnail of it.
 * Stored in prefs, so it follows the account to other devices.
 *
 * Each card draws its preview in ITS OWN theme's values, set as custom
 * properties on the preview box, not in the current theme -- otherwise every
 * card would look like the theme that is already on.
 */

/* Each card's heading is set in the theme's own face, so the faces load when
   the picker opens rather than when one is chosen. One stylesheet link per
   theme; the browser dedupes a family two themes share. */
function usePreviewFonts() {
  useEffect(() => {
    for (const t of THEMES) {
      if (!t.fontHref) continue;
      const id = `lh-font-preview-${t.id}`;
      if (document.getElementById(id)) continue;
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = t.fontHref;
      document.head.appendChild(link);
    }
  }, []);
}

function Preview({ theme }) {
  const v = themeVars(theme);
  const ink = (p) => `color-mix(in oklab, ${theme.ink} ${p}%, transparent)`;
  return (
    <div
      aria-hidden="true"
      className="relative h-28 overflow-hidden p-3 flex flex-col justify-between"
      style={{ background: theme.paper, color: theme.ink, fontFamily: v['--sans'] }}
    >
      <div>
        <div
          style={{
            fontFamily: v['--heading'],
            textTransform: v['--lh-case-display'],
            letterSpacing: v['--lh-display-tracking'],
            fontWeight: 700,
            fontSize: 20,
            lineHeight: 1.05,
          }}
        >
          The Archive
        </div>
        <div className="mt-1 text-[11px] leading-snug" style={{ color: theme.text }}>
          1,284 games, 312 beaten
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span
          className="px-2 py-1 text-[10px] font-medium leading-none"
          style={{
            background: theme.fill,
            color: theme.onFill,
            borderRadius: v['--lh-radius-control'],
            textTransform: v['--lh-case-label'],
            letterSpacing: v['--lh-label-tracking'],
          }}
        >
          Playing
        </span>
        <span
          className="px-2 py-1 text-[10px] font-medium leading-none"
          style={{
            border: `1px solid ${ink(25)}`,
            color: ink(75),
            borderRadius: v['--lh-radius-control'],
            textTransform: v['--lh-case-label'],
            letterSpacing: v['--lh-label-tracking'],
          }}
        >
          Backlog
        </span>
      </div>
    </div>
  );
}

export default function AppearanceDialog({ onClose }) {
  const [current, setCurrent] = useState(() => getPrefs().theme);
  /* Focus opens on the theme that is on, as a radio group should, which also
     scrolls it into view when it sits below the first screen of cards. */
  const checkedRef = useRef(null);
  usePreviewFonts();

  /* A sync from another device can change the theme while this is open. */
  useEffect(() => {
    const onPrefs = () => setCurrent(getPrefs().theme);
    window.addEventListener('moctale_prefs_update', onPrefs);
    window.addEventListener('moctale_sync_update', onPrefs);
    return () => {
      window.removeEventListener('moctale_prefs_update', onPrefs);
      window.removeEventListener('moctale_sync_update', onPrefs);
    };
  }, []);

  const choose = (id) => {
    setPrefs({ theme: id });
    setCurrent(id);
  };

  const active = getTheme(current);

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="appearance-title"
      describedBy="appearance-body"
      initialFocus={checkedRef}
      panelClassName="w-full max-w-3xl max-h-[88vh] overflow-y-auto custom-scrollbar p-5 sm:p-6"
    >
      <div className="lh-label text-white/60 mb-2">Appearance</div>
      <h3 id="appearance-title" className="lh-display text-xl text-white mb-2">Choose A Theme</h3>
      <p id="appearance-body" className="text-[15px] leading-relaxed text-white/60 mb-6 max-w-[60ch]">
        Changes the colours, type and shape of the whole app. It applies straight away and follows your account to your other devices.
      </p>
      <p className="text-[13px] leading-relaxed text-white/60 -mt-4 mb-6 max-w-[60ch]">
        Themes marked Preview also change fonts, corners or texture. They are still being tested, so some screens may look off.
      </p>

      <div role="radiogroup" aria-labelledby="appearance-title">
        {THEME_GROUPS.map(group => {
          const themes = THEMES.filter(t => t.group === group.id);
          if (!themes.length) return null;
          return (
            <section key={group.id} className="mb-7">
              <h4 className="lh-label text-white mb-1">{group.label}</h4>
              <p className="text-[13px] text-white/50 mb-3">{group.blurb}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {themes.map(t => {
                  const on = t.id === current;
                  return (
                    <button
                      key={t.id}
                      ref={on ? checkedRef : undefined}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => choose(t.id)}
                      className={`group text-left border overflow-hidden cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 ${
                        on ? 'border-white' : 'border-white/20 hover:border-white/60'
                      }`}
                    >
                      <Preview theme={t} />
                      <span className="flex items-start gap-3 p-3 border-t border-white/15">
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="lh-label text-white">{t.name}</span>
                            {isPreviewTheme(t) && (
                              <span className="lh-label px-1.5 py-1 border border-white/40 text-white/70">Preview</span>
                            )}
                          </span>
                          <span className="block text-[13px] leading-snug text-white/60 mt-1.5">{t.description}</span>
                        </span>
                        <span
                          aria-hidden="true"
                          className={`shrink-0 w-5 h-5 flex items-center justify-center border ${
                            on ? 'border-white bg-white text-black' : 'border-white/30 text-transparent'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" strokeWidth={3} />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-white/15">
        <p className="text-[13px] text-white/60 py-3" aria-live="polite">
          Current theme: <span className="text-white">{active.name}</span>
          {isPreviewTheme(active) && ' (Preview)'}
        </p>
        <button
          onClick={onClose}
          className="ml-auto lh-label px-4 py-2 border border-white bg-white text-black hover:bg-neutral-200 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}
