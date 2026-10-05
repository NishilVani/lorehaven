import { useEffect, useState } from 'react';
import Dialog from './Dialog';

/* A QR code for a LoreHaven link, so another phone can open the same page:
 * point its camera (or LoreHaven's own scanner) at the screen.
 *
 * Always dark modules on a light ground, whatever the theme: a light-on-dark
 * code is what some camera apps fail to read. Those two colours are the one
 * place the page ignores the theme on purpose. The encoder (uqr, no
 * dependencies) loads only when the dialog opens. */

const QR_DARK = '#000000';
const QR_LIGHT = '#ffffff';

function QrSvg({ text, label }) {
  const [code, setCode] = useState(null);
  useEffect(() => {
    let live = true;
    import('uqr').then(({ encode }) => {
      if (live) setCode(encode(text, { ecc: 'M', border: 2 }));
    }).catch(() => { if (live) setCode(false); });
    return () => { live = false; };
  }, [text]);

  if (code === false) return <p className="text-sm text-white/60">The code could not be drawn. Share the link instead.</p>;
  if (!code) return <div className="w-full aspect-square bg-white/5" aria-hidden="true" />;

  /* One path for all modules: a 41x41 code is up to 1,681 squares, and a
     single path paints in one go where that many rects would not. */
  let d = '';
  code.data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
  return (
    <svg
      viewBox={`0 0 ${code.size} ${code.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="w-full h-auto block"
    >
      <rect width={code.size} height={code.size} fill={QR_LIGHT} />
      <path d={d} fill={QR_DARK} />
    </svg>
  );
}

export default function QrCodeDialog({ url, title, onClose }) {
  return (
    <Dialog open onClose={onClose} labelledBy="qr-title" describedBy="qr-body" panelClassName="w-full max-w-sm p-6">
      <div className="lh-label text-white/60 mb-2">QR Code</div>
      <h3 id="qr-title" className="lh-display text-xl text-white mb-2">{title}</h3>
      <p id="qr-body" className="text-[15px] leading-relaxed text-white/60 mb-5">
        Scan it with another phone&rsquo;s camera, or with Scan QR Code in the LoreHaven app, to open this page there.
      </p>
      <div className="mx-auto w-full max-w-[280px] mb-5">
        <QrSvg text={url} label={`QR code for ${title}`} />
      </div>
      <p className="text-[13px] text-white/50 break-all mb-6">{url}</p>
      <button
        onClick={onClose}
        className="lh-label px-4 py-2 border border-white bg-white text-black hover:bg-neutral-200 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        Done
      </button>
    </Dialog>
  );
}
