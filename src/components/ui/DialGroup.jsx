/* The control that renders one recommendation dial. Its options live in
 * constants/prefs so the dialog and the profile band cannot drift apart.
  */

function DialGroup({ legend, blurb, options, value, onChange }) {
  return (
    <fieldset className="mb-6 border-0 p-0 m-0">
      <legend className="lh-label text-white/60 mb-1 p-0">{legend}</legend>
      <p className="text-[13px] text-white/50 mb-3">{blurb}</p>
      {/* Radios, not buttons: exactly one applies, and assistive tech should say
          so rather than announcing four independent controls. */}
      <div role="radiogroup" aria-label={legend} className="flex flex-wrap gap-2">
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              title={opt.hint}
              className={`tap lh-label px-3 py-2.5 border cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
                active
                  ? 'border-white bg-white text-black'
                  : 'border-white/20 text-white/60 hover:border-white/70 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-white/50 mt-2">
        {options.find(o => o.value === value)?.hint}
      </p>
    </fieldset>
  );
}

export default DialGroup;
