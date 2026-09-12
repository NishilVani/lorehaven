import { useState, useEffect, useRef } from 'react';

const GAP = 48;

/* `as` lets a caller render the outer element as a heading (e.g. as="h3" for a
   card title) so the visual hierarchy is also exposed to assistive tech, without
   changing any layout. Defaults to a div.

   `showTitle` turns off the native tooltip an overflowing text otherwise carries.
   A card title needs it; a platform pill does not, because it scrolls on hover and
   its control's accessible name already holds the full label. */
export default function MarqueeText({ text, className, speed = 40, vertical = false, as: Tag = 'div', showTitle = true }) {
    const containerRef = useRef(null);
    const textRef = useRef(null);
    const [state, setState] = useState({ overflows: false, dist: 0, dur: '5s' });

    /* A game card carries four of these, so a shelf of 58 cards mounts ~170.
       Two costs came out of that, both paid on every library tab switch:
       every instance re-rendered a second time even when nothing had changed,
       and every instance measured and observed itself even when it was far
       below the fold. Measurement is now gated on visibility and the state
       write is skipped when the result is identical. */
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let timer, ro = null;

        const measure = () => {
            const textEl = textRef.current;
            if (!container || !textEl) return;
            const size = vertical ? 'height' : 'width';
            const containerS = container.getBoundingClientRect()[size];
            const textS = textEl.getBoundingClientRect()[size];
            // Not laid out yet — measuring now would report a false "fits".
            if (!containerS && !textS) return;
            const totalDist = textS + GAP;
            const next = textS - containerS > 2
                ? { overflows: true, dist: totalDist, dur: `${(totalDist / speed).toFixed(2)}s` }
                : { overflows: false, dist: 0, dur: '5s' };
            setState(prev =>
                (prev.overflows === next.overflows && prev.dist === next.dist) ? prev : next);
        };
        const schedule = () => { clearTimeout(timer); timer = setTimeout(measure, 60); };

        /* rootMargin keeps the next screenful ready, so scrolling never reveals
           a title that has not worked out whether it should scroll yet. */
        const io = new IntersectionObserver((entries) => {
            if (!entries.some(e => e.isIntersecting) || ro) return;
            schedule();
            ro = new ResizeObserver(schedule);
            ro.observe(container);
        }, { rootMargin: '200px' });
        io.observe(container);

        return () => { clearTimeout(timer); io.disconnect(); if (ro) ro.disconnect(); };
    }, [text, speed, vertical]);

    const { overflows, dist, dur } = state;
    const scrollClass = vertical ? 'marquee-text-v' : 'marquee-text';
    /* w-full when vertical: a horizontal-tb block whose only content is
       vertical-rl shrink-fits to 0px on WebKit (Chromium gives it the child's
       width), and overflow-hidden on a 0px box clips the whole title. */
    return (
        <Tag ref={containerRef} title={overflows && showTitle ? text : undefined} className={`overflow-hidden m-0 ${vertical ? 'h-full w-full' : ''}`}>
            <div
                className={`${overflows ? scrollClass : 'flex'} ${vertical ? 'h-max' : 'items-baseline w-max'} ${className} whitespace-nowrap`}
                style={{
                    /* lineHeight 1.4: in vertical-rl the line box's width IS its line-height,
                       and a line-height:1 label class (lh-label) leaves an 11px-wide box for a
                       ~15px glyph column. Chromium paints the overflow; WebKit clips it inside
                       the overflow-hidden Tag, so every spine title vanished on Safari. */
                    ...(vertical ? { writingMode: 'vertical-rl', lineHeight: 1.4 } : {}),
                    ...(overflows ? { '--marquee-dist': `-${dist}px`, '--marquee-dur': dur } : {}),
                }}
            >
                <span ref={textRef}>{text}</span>
                {overflows && (
                    <span aria-hidden="true" style={vertical ? { paddingTop: GAP + 'px' } : { paddingLeft: GAP + 'px' }}>{text}</span>
                )}
            </div>
        </Tag>
    );
}
