/* Kept out of UserBlob.jsx so fast refresh keeps working on the component. */

/** The string a user's blob is grown from. Email first, so the preview in the
 *  sign-in dialog is the same creature the account will have; then the uid, for
 *  Steam and Xbox accounts that have no email. Never the display name: renaming
 *  yourself should not swap your face. */
export const blobSeed = (user, fallback = 'lorehaven') =>
  (user?.email || user?.uid || fallback).trim().toLowerCase();
