import { useState } from 'react';
import Dialog from './Dialog';
import { getPrefs, setPrefs } from '../../services/db';
import DialGroup from './DialGroup';
import { TASTE, ERA } from '../../constants/prefs';

/* Taste preferences — two dials, read by BOTH recommendation surfaces.
 *
 * Explore scores games you do not own; Pick Next scores games you do. They share
 * these values so the two cannot disagree about what you like.
 *
 * The dials themselves live in ui/DialGroup, shared with the profile's taste
 * band so the two cannot offer different options for the same setting.
 */

export default function PreferencesDialog({ onClose }) {
  const [prefs, setLocal] = useState(getPrefs);

  /* Written on every change rather than behind a Save button. There is nothing
     to validate and nothing to lose, and the next thing you do is close the
     dialog and look at the result. */
  const update = (patch) => setLocal(setPrefs(patch));

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="prefs-title"
      describedBy="prefs-body"
      panelClassName="w-full max-w-md p-6"
    >
      <div className="lh-label text-white/60 mb-2">Recommendations</div>
      <h3 id="prefs-title" className="lh-display text-xl text-white mb-2">What Should We Suggest?</h3>
      <p id="prefs-body" className="text-[15px] leading-relaxed text-white/60 mb-6">
        These apply to Explore and to Pick For Me.
      </p>

      <DialGroup
        legend="Taste"
        blurb="How close to your existing taste should suggestions stay?"
        options={TASTE}
        value={prefs.tasteBias}
        onChange={(v) => update({ tasteBias: v })}
      />

      <DialGroup
        legend="Era"
        blurb="Favour games from a particular stretch of time."
        options={ERA}
        value={prefs.releaseEra}
        onChange={(v) => update({ releaseEra: v })}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="lh-label px-4 py-2 border border-white bg-white text-black hover:bg-neutral-200 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          Done
        </button>
        <button
          onClick={() => update({ tasteBias: 0, releaseEra: 'any' })}
          className="lh-label px-4 py-2 text-white/60 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ml-auto"
        >
          Reset
        </button>
      </div>
    </Dialog>
  );
}
