import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './pages/ImportWizard/wizard.css'
import App from './App.jsx'
import { initTheme } from './services/theme'

/* Before the first render, so no component paints in the default theme first. */
initTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
