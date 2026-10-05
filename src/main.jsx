import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './motion/motion.css'
import { initMotion } from './motion/motion'
import './pages/ImportWizard/wizard.css'
import App from './App.jsx'
import { initTheme } from './services/theme'

/* Before the first render, so no component paints in the default theme first. */
initTheme()
/* The motion level on <html>, also before the first render: the first page's
   entrance already reads it. */
initMotion()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
