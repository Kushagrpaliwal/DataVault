import { useEffect, useState } from '@lynx-js/react'

import './App.css'
import { useSession } from '../../auth/session.js'
import { LoadingState } from '../../components/primitives.js'
import { AuthScreen } from '../../screens/auth-screen.js'
import { CaptureScreen } from '../../screens/capture-screen.js'
import { HomeScreen } from '../../screens/home-screen.js'
import { RecordDetailScreen } from '../../screens/record-detail-screen.js'
import { SettingsScreen } from '../../screens/settings-screen.js'
import { VaultScreen } from '../../screens/vault-screen.js'
import { useTheme } from '../../theme.js'

type View = 'home' | 'vault' | 'capture' | 'settings'

export function App(props: { onMounted?: () => void } = {}) {
  const { loading, session, organization } = useSession()
  const { theme } = useTheme()
  const [view, setView] = useState<View>('home')
  const [recordId, setRecordId] = useState<string | null>(null)

  useEffect(() => {
    props.onMounted?.()
  }, [props.onMounted])

  const shell = theme === 'dark' ? 'app-shell theme-dark' : 'app-shell'

  if (loading) return <view className={shell}><LoadingState label="Opening DataVault..." /></view>
  if (!session) return <view className={shell}><AuthScreen /></view>

  if (recordId) {
    return <view className={shell}><RecordDetailScreen id={recordId} onBack={() => setRecordId(null)} /></view>
  }

  const openRecord = (record: { id: string }) => setRecordId(record.id)
  const openView = (nextView: View) => {
    setRecordId(null)
    setView(nextView)
  }

  return (
    <view className={shell}>
      {!organization ? <SettingsScreen /> : view === 'home' ? <HomeScreen onOpenCapture={() => openView('capture')} onOpenVault={() => openView('vault')} onOpenRecord={openRecord} /> : null}
      {organization && view === 'vault' ? <VaultScreen onOpenRecord={openRecord} /> : null}
      {organization && view === 'capture' ? <CaptureScreen onSaved={() => openView('home')} /> : null}
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
      <NavItem label="Settings" mark="..." active={view === 'settings'} disabled={false} onPress={() => onChange('settings')} />
    </view>
  )
}

function NavItem({ label, mark, active, disabled, onPress }: { label: string; mark: string; active: boolean; disabled: boolean; onPress: () => void }) {
  return <view className={`nav-item${active ? ' nav-item--active' : ''}${disabled ? ' nav-item--disabled' : ''}`} bindtap={disabled ? undefined : onPress}><text className="nav-item__mark">{mark}</text><text className="nav-item__label">{label}</text></view>
}
