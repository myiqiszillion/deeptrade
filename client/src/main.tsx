import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AcceptanceObserver from './AcceptanceObserver.tsx'

createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).get('acceptance') === '1' ? <AcceptanceObserver /> : <StrictMode>
    <App />
  </StrictMode>,
)
