import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './motion/motion.css'
import { initMotion } from './motion/motion'
import { installSharedCapture } from './motion/shared'
import { installRouteIntent, prefetchRoutesWhenIdle } from './motion/routes'
import './pages/ImportWizard/wizard.css'
import App from './App.jsx'
import { initTheme } from './services/theme'

/* Before the first render, so no component paints in the default theme first. */
initTheme()
/* The motion level on <html>, before the first render. Shared-art clicks and
   link intent are captured from the start; every page's code is fetched once
   the first page has painted and the browser is idle. */
initMotion()
installSharedCapture()
installRouteIntent()
requestAnimationFrame(() => prefetchRoutesWhenIdle())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
