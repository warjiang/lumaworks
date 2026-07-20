import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

const report = (error: unknown, source: string): void => {
  const value = error instanceof Error ? error : new Error(String(error))
  void window.lumaworks.reportRendererError({ level: 'error', message: value.message, stack: value.stack, source })
}

window.addEventListener('error', (event) => report(event.error ?? event.message, event.filename || 'window.error'))
window.addEventListener('unhandledrejection', (event) => report(event.reason, 'window.unhandledrejection'))

ReactDOM.createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => report(error, 'react.uncaught'),
  onRecoverableError: (error) => report(error, 'react.recoverable'),
}).render(<React.StrictMode><App /></React.StrictMode>)
