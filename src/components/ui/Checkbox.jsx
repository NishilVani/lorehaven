import { forwardRef, useEffect, useRef } from 'react';

/* `indeterminate` is a DOM property with no HTML attribute, so it is set on the
   element after render. wizard.css already draws the dash for :indeterminate,
   and the browser reports the mixed state to assistive tech on its own. */
const Checkbox = forwardRef(({ checked, onChange, className = '', indeterminate = false, ...props }, ref) => {
    const input = useRef(null);
    useEffect(() => {
        if (input.current) input.current.indeterminate = !!indeterminate;
    }, [indeterminate]);
    const setRef = (el) => {
        input.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
    };
    return (
        <span className={`ios-cb ${className}`}>
            <input
                ref={setRef}
                type="checkbox"
                checked={checked}
                onChange={onChange}
                {...props} 
            />
            <span className="ios-cb__wrapper">
                <span className="ios-cb__bg" />
                <svg className="ios-cb__icon" viewBox="0 0 24 24" fill="none">
                    <path className="ios-cb__path" d="M4 12L10 18L20 6"
                        stroke="currentColor" strokeWidth="3"
                        strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
        </span>
    );
});

export default Checkbox;
