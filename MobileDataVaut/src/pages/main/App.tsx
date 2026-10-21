import { useEffect, useState } from '@lynx-js/react'

import './App.css'
import { useSession } from '../../auth/session.js'
import { LoadingState } from '../../components/primitives.js'
import { AuthScreen } from '../../screens/auth-screen.js'
import { CaptureScreen } from '../../screens/capture-screen.js'
import { FinanceScreen } from '../../screens/finance-screen.js'
import { HomeScreen } from '../../screens/home-screen.js'
import { RecordDetailScreen } from '../../screens/record-detail-screen.js'
import { SettingsScreen } from '../../screens/settings-screen.js'
import { VaultScreen } from '../../screens/vault-screen.js'

type View = 'home' | 'vault' | 'capture' | 'finance' | 'settings'

export function App(props: { onMounted?: () => void } = {}) {
  const { loading, session, organization } = useSession()
  const [view, setView] = useState<View>('home')
  const [recordId, setRecordId] = useState<string | null>(null)

  useEffect(() => {
    props.onMounted?.()
  }, [props.onMounted])

  if (loading) return <LoadingState label="Opening DataVault..." />
  if (!session) return <AuthScreen />

  if (recordId) {
    return <RecordDetailScreen id={recordId} onBack={() => setRecordId(null)} />
  }

  const openRecord = (record: { id: string }) => setRecordId(record.id)
  const openView = (nextView: View) => {
    setRecordId(null)
    setView(nextView)
  }

  return (
    <view className="app-shell">
      {!organization ? <SettingsScreen /> : view === 'home' ? <HomeScreen onOpenCapture={() => openView('capture')} onOpenVault={() => openView('vault')} onOpenRecord={openRecord} /> : null}
      {organization && view === 'vault' ? <VaultScreen onOpenRecord={openRecord} /> : null}
      {organization && view === 'capture' ? <CaptureScreen onSaved={() => openView('home')} /> : null}
      {organization && view === 'finance' ? <FinanceScreen /> : null}
      {view === 'settings' ? <SettingsScreen /> : null}
      <BottomNav view={view} onChange={openView} disabled={!organization} />
    </view>
  )
}

function BottomNav({ view, onChange, disabled }: { view: View; onChange: (view: View) => void; disabled: boolean }) {
  return (
    <view className="bottom-nav">
      <NavItem label="Home" mark="H" active={view === 'home'} disabled={disabled} onPress={() => onChange('home')} />
      <NavItem label="Vault" mark="V" active={view === 'vault'} disabled={disabled} onPress={() => onChange('vault')} />
      <view className="bottom-nav__capture" bindtap={disabled ? undefined : () => onChange('capture')}><text className="bottom-nav__capture-mark">+</text><text className="bottom-nav__capture-label">Capture</text></view>
      <NavItem label="Finance" mark="$" active={view === 'finance'} disabled={disabled} onPress={() => onChange('finance')} />
      <NavItem label="Settings" mark="..." active={view === 'settings'} disabled={false} onPress={() => onChange('settings')} />
    </view>
  )
}

function NavItem({ label, mark, active, disabled, onPress }: { label: string; mark: string; active: boolean; disabled: boolean; onPress: () => void }) {
  return <view className={`nav-item${active ? ' nav-item--active' : ''}${disabled ? ' nav-item--disabled' : ''}`} bindtap={disabled ? undefined : onPress}><text className="nav-item__mark">{mark}</text><text className="nav-item__label">{label}</text></view>
}
