import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque/wght.css'
import '@fontsource-variable/source-sans-3/wght.css'
import './index.css'
import App from './App.tsx'
import { applyPrefs, readPrefs } from './lib/studentPrefs'

// Student reading options (text size, contrast, motion) apply from the first paint.
applyPrefs(readPrefs())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
