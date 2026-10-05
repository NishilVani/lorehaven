import { useEffect, useState } from 'react';
import Dialog from './Dialog';
import DialGroup from './DialGroup';
import { getDeviceSettings, setDeviceSettings } from '../../services/native/device';
import { REMINDER_SHELVES, requestReminderPermission } from '../../services/native/reminders';
import { haptic } from '../../services/native/haptics';
import { nativeCall } from '../../services/native/bridge';
import { toast } from './toastBus';

/* The Android app's own settings: release-day reminders, the evening digest of
 * library updates, haptic feedback, and adding the home-screen widgets.
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
const DIGEST = [
  { value: false, label: 'Off' },
  { value: true, label: 'Evening Digest', hint: 'One notification at 18:00 when something changed' },
];
const WIDGETS = [
  { kind: 'playing', label: 'Now Playing' },
  { kind: 'upNext', label: 'Up Next' },
  { kind: 'soon', label: 'Releasing Soon' },
];
const ONOFF = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
];

export default function PhoneSettingsDialog({ onClose }) {
  const [settings, setLocal] = useState(getDeviceSettings);
  const [denied, setDenied] = useState(false);
  const [digestDenied, setDigestDenied] = useState(false);
  /* Null until the launcher answers: only launchers that support pinning get
     the buttons; everyone else is told where widgets live. */
  const [canPin, setCanPin] = useState(null);

  useEffect(() => {
    let live = true;
    nativeCall('canPinWidgets')
      .then(r => { if (live) setCanPin(!!r?.supported); })
      .catch(() => { if (live) setCanPin(false); });
    return () => { live = false; };
  }, []);

  const pinWidget = async (kind) => {
    const r = await nativeCall('pinWidget', { kind }).catch(() => null);
    if (!r?.requested) toast('Long-press your home screen and choose Widgets to add it');
  };
  const r = settings.reminders;

  const setWhen = async (v) => {
    if (v === 'off') { setLocal(setDeviceSettings({ reminders: { enabled: false } })); return; }
    const granted = await requestReminderPermission().catch(() => false);
    setDenied(!granted);
    setLocal(setDeviceSettings({ reminders: { enabled: granted, when: v } }));
  };

  const setDigest = async (v) => {
    if (!v) { setLocal(setDeviceSettings({ updates: false })); return; }
    const granted = await requestReminderPermission().catch(() => false);
    setDigestDenied(!granted);
    setLocal(setDeviceSettings({ updates: granted }));
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
        legend="Library Updates"
        blurb="New release dates, trailers and ratings for games in your library, gathered while the app is open."
        options={DIGEST}
        value={settings.updates}
        onChange={setDigest}
      />
      {digestDenied && (
        <p role="alert" className="text-[13px] text-[var(--warning)] -mt-3 mb-6">
          Android did not allow notifications. Turn them on for LoreHaven in your phone&rsquo;s settings, then try again.
        </p>
      )}

      <DialGroup
        legend="Haptic Feedback"
        blurb="A small buzz when you add, move, rate or pick up a game."
        options={ONOFF}
        value={settings.haptics}
        onChange={(v) => { setLocal(setDeviceSettings({ haptics: v })); if (v) haptic('success'); }}
      />

      <fieldset className="mb-6 border-0 p-0 m-0">
        <legend className="lh-label text-white/60 mb-1 p-0">Home Screen Widgets</legend>
        {canPin ? (
          <>
            <p className="text-[13px] text-white/50 mb-3">Add one, and Android asks where to put it.</p>
            <div className="flex flex-wrap gap-2">
              {WIDGETS.map(w => (
                <button
                  key={w.kind}
                  type="button"
                  onClick={() => pinWidget(w.kind)}
                  className="tap lh-label px-3 py-2.5 border border-white/20 text-white/80 hover:border-white/70 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  Add {w.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-white/50">
            Now Playing, Up Next and Releasing Soon. Long-press your home screen, choose Widgets, then LoreHaven.
          </p>
        )}
      </fieldset>

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
