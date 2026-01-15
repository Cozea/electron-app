import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConvexProvider } from './contexts/ConvexProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider>
      <App />
    </ConvexProvider>
  </StrictMode>,
)
