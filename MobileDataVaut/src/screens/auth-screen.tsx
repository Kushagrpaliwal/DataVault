import { useState } from '@lynx-js/react'

import { useSession } from '../auth/session.js'
import { Button, Field, TextInput } from '../components/primitives.js'

type AuthMode = 'login' | 'register' | 'forgot'

export function AuthScreen() {
  const { login, register, api, error: sessionError } = useSession()
  const [mode, setMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'forgot') {
        await api.forgotPassword(email.trim())
        setNotice('If the account exists, a reset link is on its way.')
      } else if (mode === 'register') {
        await register(name.trim(), email.trim(), password)
      } else {
        await login(email.trim(), password)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please check your details and try again.')
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'register' ? 'Make your memory useful.' : mode === 'forgot' ? 'Find your way back.' : 'Your financial memory, ready.'
  const subtitle = mode === 'register'
    ? 'Save the things you need to remember, then find them when it matters.'
    : mode === 'forgot'
      ? 'Enter your email and DataVault will send a secure reset link.'
      : 'A calm, searchable home for the pages and passages you collect.'

  return (
    <scroll-view className="auth-scroll" scroll-orientation="vertical">
      <view className="auth-screen">
        <view className="auth-brand">
          <view className="brand-mark"><text>D</text></view>
          <text className="brand-name">DataVault</text>
        </view>
        <view className="auth-hero">
          <text className="auth-hero__eyebrow">PRIVATE MEMORY FOR REAL LIFE</text>
          <text className="auth-hero__title">{title}</text>
          <text className="auth-hero__body">{subtitle}</text>
        </view>
        <view className="auth-card">
          {mode === 'register' ? (
            <Field label="Your name"><TextInput value={name} onChange={setName} placeholder="Ava Sharma" /></Field>
          ) : null}
          <Field label="Email"><TextInput value={email} onChange={setEmail} placeholder="you@example.com" type="email" /></Field>
          {mode !== 'forgot' ? (
            <Field label="Password" hint={mode === 'register' ? 'At least 10 characters with upper-case, lower-case, and a number.' : undefined}>
              <TextInput value={password} onChange={setPassword} placeholder="Your password" type="password" />
            </Field>
          ) : null}
          {error || sessionError ? <text className="form-error">{error ?? sessionError}</text> : null}
          {notice ? <text className="form-notice">{notice}</text> : null}
          <Button full onPress={submit} disabled={busy}>
            {busy ? 'Working...' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
          </Button>
          <view className="auth-links">
            {mode === 'login' ? <view bindtap={() => setMode('forgot')}><text className="text-link">Forgot password?</text></view> : null}
            {mode === 'forgot' ? <view bindtap={() => setMode('login')}><text className="text-link">Back to sign in</text></view> : null}
            {mode !== 'register' ? <view bindtap={() => setMode('register')}><text className="text-link">Create a new account</text></view> : null}
            {mode === 'register' ? <view bindtap={() => setMode('login')}><text className="text-link">Already have an account?</text></view> : null}
          </view>
        </view>
        <text className="auth-footnote">Your data stays in your DataVault workspace. Mobile uses the same API and security rules as the web app.</text>
      </view>
    </scroll-view>
  )
}
