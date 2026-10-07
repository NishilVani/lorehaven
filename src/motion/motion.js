/* The motion level on this device.
 *
 * One motion language for everyone (docs/superpowers/specs/
 * 2026-10-06-motion-design.md), plus Reduced. The choice lives under
 * Appearance > Motion and is kept on the device, never synced:
 *
 *   system   full motion, or reduced when the OS asks for reduced motion
 *   reduced  cross-fades only
 *
 * The level in force is written to <html data-motion="full|reduced">; every
 * motion rule keys off it. The personality (timing tokens) is written to
 * <html data-personality>; only "cinematic" exists for now. */
import { haptic } from '../services/native/haptics.js';
import { migrateMotionChoice } from './classify.js';

const KEY = 'lorehaven_motion';
export const MOTION_CHOICES = ['system', 'reduced'];
export const MOTION_EVENT = 'lorehaven_motion';

const systemReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function getMotionChoice() {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? 'system' : migrateMotionChoice(v);
  } catch {
    return 'system';
  }
}

/** 'full' | 'reduced' for a choice on this device now. */
export function resolveMotion(choice, reduced = systemReduced()) {
  if (choice === 'reduced') return 'reduced';
  return reduced ? 'reduced' : 'full';
}

/** The level in force, as written on <html>. */
export const motionLevel = () =>
  (typeof document !== 'undefined' && document.documentElement.dataset.motion) || 'full';

export const reducedMotion = () => motionLevel() === 'reduced';

function apply() {
  const root = document.documentElement;
  root.dataset.motion = resolveMotion(getMotionChoice());
  root.dataset.personality = 'cinematic';
}

export function setMotionChoice(choice) {
  try {
    if (choice === 'reduced') localStorage.setItem(KEY, 'reduced');
    else localStorage.removeItem(KEY);
  } catch { /* not kept; applies for this session */ }
  apply();
  window.dispatchEvent(new Event(MOTION_EVENT));
}

/** Finishing a game: the success haptic (spec 2.5). */
export function celebrate() {
  haptic('success');
}

let started = false;

/** Applies the level once at startup and follows the system setting. */
export function initMotion() {
  if (typeof document === 'undefined') return;
  apply();
  if (started) return;
  started = true;
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
}
