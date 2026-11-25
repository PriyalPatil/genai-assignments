import { useState } from 'react'

/**
 * Predefined credentials (no database), set in frontend/.env:
 *   VITE_LOGIN_USERNAME=...
 *   VITE_LOGIN_PASSWORD=...
 * The check runs in the browser, so this is a simple gate for the app, not real security.
 */
const VALID_USERNAME = import.meta.env.VITE_LOGIN_USERNAME ?? ''
const VALID_PASSWORD = import.meta.env.VITE_LOGIN_PASSWORD ?? ''
const IS_CONFIGURED = VALID_USERNAME !== '' && VALID_PASSWORD !== ''

interface LoginProps {
  onLoginSuccess: () => void
}

export function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!IS_CONFIGURED) {
      setError('Login is not configured. Set VITE_LOGIN_USERNAME and VITE_LOGIN_PASSWORD in frontend/.env.')
      return
    }

    if (!username.trim() || !password) {
      setError('Please enter both username and password.')
      return
    }

    if (username.trim() === VALID_USERNAME && password === VALID_PASSWORD) {
      setError(null)
      onLoginSuccess()
    } else {
      setError('Invalid username or password. Please try again.')
      setPassword('')
    }
  }

  return (
    <div className="login-page">
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          color: #1f2a24;
          line-height: 1.6;
          min-height: 100vh;
          background:
            radial-gradient(900px 500px at 8% -8%, rgba(0,200,83,0.14), transparent 55%),
            radial-gradient(700px 400px at 100% 0%, rgba(0,200,83,0.08), transparent 50%),
            #f4f7f3;
          background-attachment: fixed;
        }

        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .login-card {
          width: 100%;
          max-width: 400px;
          background: #ffffff;
          border: 1px solid #e3e8e0;
          border-radius: 18px;
          padding: 32px 28px;
          box-shadow: 0 10px 30px rgba(31,42,36,0.08);
        }

        .login-title {
          font-size: 1.6rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          text-align: center;
          margin-bottom: 4px;
        }
        .login-title .accent { color: #009624; }

        .login-subtitle {
          text-align: center;
          color: #6b7a72;
          font-size: 14px;
          margin-bottom: 24px;
        }

        .login-field { margin-bottom: 16px; }

        .login-label {
          display: block;
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 6px;
        }

        .login-input {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid #e3e8e0;
          border-radius: 11px;
          font-size: 14px;
          font-family: inherit;
          color: #1f2a24;
          background: #fbfdfa;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .login-input:focus {
          outline: none;
          border-color: #00c853;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(0,200,83,0.18);
        }

        .login-error {
          background: #fdeceb;
          border: 1px solid #f5c2be;
          color: #b3261e;
          font-size: 13.5px;
          padding: 10px 14px;
          border-radius: 10px;
          margin-bottom: 16px;
        }

        .login-btn {
          width: 100%;
          margin-top: 4px;
          background: linear-gradient(120deg, #00c853, #009624);
          color: #fff;
          border: none;
          padding: 13px 28px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(0,200,83,0.35);
          transition: transform 0.15s ease, box-shadow 0.25s ease;
        }
        .login-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 14px 30px rgba(0,200,83,0.45);
        }
        .login-btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(0,200,83,0.3); }
      `}</style>

      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <h1 className="login-title">User Story to <span className="accent">Tests</span></h1>
        <p className="login-subtitle">Sign in to continue</p>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <div className="login-field">
          <label htmlFor="username" className="login-label">Username</label>
          <input
            id="username"
            type="text"
            className="login-input"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(null) }}
            placeholder="Enter your username"
            autoComplete="username"
            autoFocus
          />
        </div>

        <div className="login-field">
          <label htmlFor="password" className="login-label">Password</label>
          <input
            id="password"
            type="password"
            className="login-input"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(null) }}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
        </div>

        <button type="submit" className="login-btn">Login</button>
      </form>
    </div>
  )
}
