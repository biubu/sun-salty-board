import React, { useState, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nContext, translate, type Locale } from './utils/i18n'
import './styles/global.css'

function Root() {
  const [locale, setLocaleState] = useState<Locale>('en')
  const setLocale = useCallback((l: Locale) => setLocaleState(l), [])
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  )
  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      <App />
    </I18nContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
