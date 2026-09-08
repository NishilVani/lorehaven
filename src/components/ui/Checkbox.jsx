import { forwardRef } from 'react';

const Checkbox = forwardRef(({ checked, onChange, className = '', ...props }, ref) => {
    return (
        <span className={`ios-cb ${className}`}>
            <input 
                ref={ref} 
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
