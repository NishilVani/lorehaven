/* One empty / failure plate for the thirteen hand-rolled bands the QA run found.
   `action` is the control the plate names, rendered inside it rather than 85px
   away; `failed` swaps the copy tone and supplies a Retry that remounts the
   route through the same event ApiErrorBanner uses, so a failed index never
   reads as an empty one. */
const retryRoutes = () => window.dispatchEvent(new Event('moctale_sync_update'));

export default function EmptyPlate({ icon: Icon, title, body, action = null, failed = false }) {
  return (
    <div className="border border-white/15 px-6 py-14 flex flex-col items-center gap-3 text-center" role={failed ? 'alert' : undefined}>
      {Icon && <Icon className="w-8 h-8 text-white/25" strokeWidth={1.25} aria-hidden="true" />}
      <h2 className="lh-display text-xl text-white/60 m-0">{title}</h2>
      {body && <div className="lh-label text-white/40 max-w-[46ch]">{body}</div>}
      {failed ? (
        <button
          type="button"
          onClick={retryRoutes}
          className="lh-label mt-2 px-4 h-9 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white focus:bg-white focus:text-black focus-visible:outline-none transition-colors cursor-pointer"
        >
          Try again
        </button>
      ) : action}
    </div>
  );
}
