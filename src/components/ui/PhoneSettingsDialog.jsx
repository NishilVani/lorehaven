import { useState } from 'react';
import Dialog from './Dialog';
import DialGroup from './DialGroup';
import { getDeviceSettings, setDeviceSettings } from '../../services/native/device';
import { REMINDER_SHELVES, requestReminderPermission } from '../../services/native/reminders';
import { haptic } from '../../services/native/haptics';

/* The Android app's own settings: release-day reminders and haptic feedback.
 * Kept on this phone and never synced (services/native/device.js): a reminder
 * needs this phone's notification permission, and a laptop has no buzz to turn
 * off. Opened from the account menu, which only offers it in the Android app.
 *
 * Written on every change, like the recommendation dials. Turning reminders on
 * asks Android for permission first; refused, the setting stays off and the
 * dialog says how to change it, rather than claiming reminders it cannot send. */

const WHEN = [
  { value: 'off', label: 'Off' },
  { value: 'day-of', label: 'On Release Day', hint: '10:00 on the day it comes out' },
  { value: 'day-before', label: 'The Evening Before', hint: '18:00 the day before' },
];
const ONOFF = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
];

export default function PhoneSettingsDialog({ onClose }) {
  const [settings, setLocal] = useState(getDeviceSettings);
  const [denied, setDenied] = useState(false);
  const r = settings.reminders;

  const setWhen = async (v) => {
    if (v === 'off') { setLocal(setDeviceSettings({ reminders: { enabled: false } })); return; }
    const granted = await requestReminderPermission().catch(() => false);
    setDenied(!granted);
    setLocal(setDeviceSettings({ reminders: { enabled: granted, when: v } }));
  };

  const toggleShelf = (shelf) => {
    const has = r.shelves.includes(shelf);
    /* At least one shelf: an empty set would be "on" and remind about nothing. */
    if (has && r.shelves.length === 1) return;
    const shelves = has ? r.shelves.filter(s => s !== shelf) : [...r.shelves, shelf];
    setLocal(setDeviceSettings({ reminders: { shelves } }));
    haptic('select');
  };

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="phone-title"
      describedBy="phone-body"
      panelClassName="w-full max-w-md p-6"
    >
      <div className="lh-label text-white/60 mb-2">This Phone</div>
      <h3 id="phone-title" className="lh-display text-xl text-white mb-2">On This Phone</h3>
      <p id="phone-body" className="text-[15px] leading-relaxed text-white/60 mb-6">
        These stay on this phone and are not synced.
      </p>

      <DialGroup
        legend="Release Reminders"
        blurb="A notification when a game you are waiting for comes out."
        options={WHEN}
        value={r.enabled ? r.when : 'off'}
        onChange={setWhen}
      />
      {denied && (
        <p role="alert" className="text-[13px] text-[var(--warning)] -mt-3 mb-6">
          Android did not allow notifications. Turn them on for LoreHaven in your phone&rsquo;s settings, then try again.
        </p>
      )}

      {r.enabled && (
        <fieldset className="mb-6 border-0 p-0 m-0">
          <legend className="lh-label text-white/60 mb-1 p-0">Remind Me About</legend>
          <p className="text-[13px] text-white/50 mb-3">Games on these shelves with a release date.</p>
          <div className="flex flex-wrap gap-2">
            {REMINDER_SHELVES.map(shelf => {
              const on = r.shelves.includes(shelf);
              return (
                <button
                  key={shelf}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleShelf(shelf)}
                  className={`tap lh-label px-3 py-2.5 border cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
                    on ? 'border-white bg-white text-black' : 'border-white/20 text-white/60 hover:border-white/70 hover:text-white'
                  }`}
                >
                  {shelf}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <DialGroup
        legend="Haptic Feedback"
        blurb="A small buzz when you add, move, rate or pick up a game."
        options={ONOFF}
        value={settings.haptics}
        onChange={(v) => { setLocal(setDeviceSettings({ haptics: v })); if (v) haptic('success'); }}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="lh-label px-4 py-2 border border-white bg-white text-black hover:bg-neutral-200 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}
