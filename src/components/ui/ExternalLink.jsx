import { isTauri, openExternal } from '../../services/openExternal';

/* An ordinary link on the web, so middle-click, copy link and the status bar all
   behave. Inside Tauri the click goes to the shell plugin instead, because the
   webview ignores target="_blank". */
export default function ExternalLink({ href, onClick, children, ...rest }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !isTauri()) return;
        e.preventDefault();
        openExternal(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
