import React from 'react'
import ReactDOM from 'react-dom/client'
import appleTouchIconUrl from '../../../assets/branding/lumaworks-icons/web/apple-touch-icon.png?url'
import faviconUrl from '../../../assets/branding/lumaworks-icons/web/favicon-32x32.png?url'
import { App } from './App'
import './styles.css'

for (const icon of [
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: faviconUrl },
  { rel: 'apple-touch-icon', type: 'image/png', sizes: '180x180', href: appleTouchIconUrl },
]) {
  const link = document.createElement('link')
  Object.assign(link, icon)
  document.head.append(link)
}

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
