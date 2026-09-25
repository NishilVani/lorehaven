import { useCallback, useEffect, useRef, useState } from 'react';
import { Blobatar } from '@blobatar/react';
import { useGaze } from '@blobatar/react/gaze';
import {
  idle, happy, sad, surprised, wink, sleepy, smug, unsure, scared, love, shy, sick, thinking,
} from 'blobatar/expression';
import 'blobatar/motion.css';
import 'blobatar/gaze.css';

/* The user's picture: a blobatar (blobatar.dev), a small creature generated
 * from a string. It is drawn in the page from the seed; nothing is uploaded
 * and no request is made, so an email used as the seed never leaves the device.
 *
 * One component, three places: the nav (small, wakes on hover), the profile
 * header (large, follows the pointer, can be poked, falls asleep) and the
 * sign-in dialog (reacts to the form). Each caller says how it should react;
 * this owns the timing so the three behave alike.
 *
 * The face is decoration. Every state it shows (busy, failed, saved) is
 * already announced by the text around it, so the creature adds character,
 * never information. Under prefers-reduced-motion the library renders it
 * still, and poses change without morphing.
 */

const POSES = { idle, happy, sad, surprised, wink, sleepy, smug, unsure, scared, love, shy, sick, thinking };

/* What a poke gets back, in order, so repeated pokes read as a conversation
   rather than a random reel. */
const POKE_REPLIES = ['happy', 'wink', 'surprised', 'love', 'smug'];
const REPLY_MS = 1200;
/* Poke it too fast and it gets dizzy. */
const DIZZY_POKES = 5;
const DIZZY_WINDOW_MS = 2500;
const DIZZY_MS = 1800;

export default function UserBlob({
  seed,
  size = 24,
  /* The resting pose the caller wants, e.g. 'thinking' while saving. */
  mood = 'idle',
  /* 'always' for a single large blob, 'hover' for chrome. */
  animate = 'hover',
  /* Pose while the pointer is over it. */
  hoverMood = null,
  /* Where the eyes point: 'pointer', 'rest', an element, a {x, y} point, or null. */
  follow = null,
  /* Clickable: each poke gets a reaction. */
  pokeable = false,
  /* Fall asleep after this long with no input anywhere on the page. 0 = never. */
  sleepAfter = 0,
  label = 'Profile picture',
  className = '',
  /* Change this value (a counter works) to make it cheer once. */
  celebrate = 0,
}) {
  const [reaction, setReaction] = useState(null);
  const [hovered, setHovered] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const replyTimer = useRef(0);
  const pokes = useRef({ n: 0, times: [] });

  const { ref, lookAt } = useGaze({ travel: size >= 64 ? 3 : 2 });
  useEffect(() => { lookAt(follow); }, [lookAt, follow]);

  const react = useCallback((pose, ms = REPLY_MS) => {
    clearTimeout(replyTimer.current);
    setReaction(pose);
    replyTimer.current = setTimeout(() => setReaction(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(replyTimer.current), []);

  const firstCelebrate = useRef(true);
  useEffect(() => {
    if (firstCelebrate.current) { firstCelebrate.current = false; return; }
    react('happy', 1600);
  }, [celebrate, react]);

  /* Sleep: any input anywhere resets the clock. Waking is a start. */
  useEffect(() => {
    if (!sleepAfter) return undefined;
    let timer = 0;
    let sleeping = false;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { sleeping = true; setAsleep(true); }, sleepAfter);
    };
    const onInput = () => {
      if (sleeping) {
        sleeping = false;
        setAsleep(false);
        react('surprised', 900);
      }
      arm();
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'wheel'];
    events.forEach(e => window.addEventListener(e, onInput, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, onInput));
    };
  }, [sleepAfter, react]);

  const poke = () => {
    const now = Date.now();
    const p = pokes.current;
    p.times = [...p.times.filter(t => now - t < DIZZY_WINDOW_MS), now];
    if (p.times.length >= DIZZY_POKES) {
      p.times = [];
      react('sick', DIZZY_MS);
      return;
    }
    react(POKE_REPLIES[p.n % POKE_REPLIES.length]);
    p.n += 1;
  };

  /* A reaction outranks everything; sleep outranks the caller's mood only
     when the caller has nothing to say (an error should wake it up). */
  const current = reaction
    || (hovered && hoverMood)
    || (mood !== 'idle' ? mood : null)
    || (asleep ? 'sleepy' : 'idle');

  const blob = (
    <Blobatar
      ref={ref}
      name={seed || 'lorehaven'}
      size={size}
      animate={animate}
      expression={POSES[current] || idle}
      aria-hidden={pokeable ? 'true' : undefined}
      title={pokeable ? undefined : label}
      className="block"
    />
  );

  const hover = hoverMood
    ? { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) }
    : {};

  if (!pokeable) {
    return <span className={`inline-flex shrink-0 ${className}`} {...hover}>{blob}</span>;
  }
  return (
    <button
      type="button"
      onClick={poke}
      aria-label={label}
      className={`inline-flex shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${className}`}
      {...hover}
    >
      {blob}
    </button>
  );
}
