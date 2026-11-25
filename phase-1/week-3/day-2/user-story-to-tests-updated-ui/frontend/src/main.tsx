/// <reference types="./vite-env.d.ts" />
import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { Login } from './components/Login'

/** Shows the Login page until valid credentials are entered, then the existing Home page (App). */
function Root() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  return isLoggedIn ? <App /> : <Login onLoginSuccess={() => setIsLoggedIn(true)} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
