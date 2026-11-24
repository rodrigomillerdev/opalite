import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { restoreWidths } from './components/ui/Resizer'
import { applySettings } from './lib/settings'
import { installZoomKeys } from './lib/zoom'
import { applyTheme, loadTheme } from './lib/theme'

// Aplica o tema antes do primeiro render para não "piscar" a cor errada.
applyTheme(loadTheme())
applySettings()
restoreWidths()
installZoomKeys()
if (navigator.userAgent.includes('Mac')) document.documentElement.classList.add('platform-mac')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
