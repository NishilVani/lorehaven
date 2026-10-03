/* The notes / review field on a library entry. One instance per page: where it
   sits depends on the status (it leads the page while you are playing, follows
   the record once you are done), but the field and its draft handling do not. */
export default function NotesEditor({ value, onChange, dirty, onSave, onCancel, review, placeholder }) {
  return (
    <div>
      <textarea
        id="game-user-notes"
        aria-label={review ? 'Review notes' : 'Personal game notes'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={1000}
        placeholder={placeholder || (review ? 'Write your review…' : 'Where you left off, things to remember…')}
        className="w-full min-h-28 bg-black border border-white/40 p-3 text-[15px] leading-relaxed text-white/80 placeholder:text-white/50 focus:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white outline-none resize-y block"
      />
      <div className="flex items-center justify-between mt-2">
        {/* --warning, not text-amber-400. Approaching the limit is the
            "recoverable problem worth looking at" role the token exists for. */}
        <span className={`lh-label tabular-nums ${value.length >= 950 ? 'text-[var(--warning)] font-bold' : 'text-white/60'}`}>
          {value.length}/1000
        </span>
        {dirty && (
          <div className="flex">
            <button
              onClick={onCancel}
              className="lh-label px-3 py-2 border border-white/15 text-white/60 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              className="lh-label px-3 py-2 border border-l-0 border-white/15 bg-white text-black hover:bg-white/70 focus-visible:bg-white/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
