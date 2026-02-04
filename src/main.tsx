import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConvexProvider } from './contexts/ConvexProvider'
import { initPerformanceMonitoring, markAppRendered } from './lib/performance/performanceMonitor'

initPerformanceMonitoring()
performance.mark('app.render.start')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider>
      <App />
    </ConvexProvider>
  </StrictMode>,
)

requestAnimationFrame(() => {
  markAppRendered()
})
