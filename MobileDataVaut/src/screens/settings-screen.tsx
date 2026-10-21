import { useState } from '@lynx-js/react'

import { useSession } from '../auth/session.js'
import { Button, Divider, Field, SectionTitle, TextInput } from '../components/primitives.js'

export function SettingsScreen() {
  const { session, organization, selectOrganization, createOrganization, logout, refresh } = useSession()
  const [workspaceName, setWorkspaceName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const addWorkspace = async () => {
    if (!workspaceName.trim()) return
    try {
      await createOrganization(workspaceName)
      setWorkspaceName('')
      setShowCreate(false)
      setMessage('Workspace created.')
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace could not be created.')
    }
  }

  return (
    <scroll-view className="page-scroll" scroll-orientation="vertical">
      <view className="screen">
        <SectionTitle eyebrow="SETTINGS" title="Make DataVault yours" />
        <view className="profile-card"><view className="profile-card__avatar"><text>{session?.user.name.slice(0, 1).toUpperCase()}</text></view><view><text className="profile-card__name">{session?.user.name}</text><text className="profile-card__email">{session?.user.email}</text></view></view>
        <SectionTitle eyebrow="WORKSPACES" title="Your spaces" action={<Button variant="secondary" onPress={() => setShowCreate(!showCreate)}>{showCreate ? 'Close' : 'New'}</Button>} />
        {session?.organizations.map((item) => <view key={item.id} className={`workspace-row${item.id === organization?.id ? ' workspace-row--active' : ''}`} bindtap={() => selectOrganization(item.id)}><view className="workspace-row__swatch" style={{ backgroundColor: item.isPersonal ? '#b8a4ed' : '#ffb084' }} /><view className="workspace-row__content"><text className="workspace-row__title">{item.name}</text><text className="workspace-row__body">{item.role} - {item.currency}</text></view><text className="workspace-row__check">{item.id === organization?.id ? 'ON' : '>'}</text></view>)}
        {showCreate ? <view className="form-card"><Field label="Workspace name"><TextInput value={workspaceName} onChange={setWorkspaceName} placeholder="e.g. Acme Finance" /></Field><Button full onPress={addWorkspace}>Create workspace</Button></view> : null}
        {message ? <text className="form-notice">{message}</text> : null}
        {error ? <text className="form-error">{error}</text> : null}
        <view className="settings-card"><text className="settings-card__label">CURRENT WORKSPACE</text><text className="settings-card__title">{organization?.name ?? 'No workspace selected'}</text><text className="settings-card__body">Organization-scoped records, permissions, and audit history are loaded from the existing DataVault API.</text><Divider /><text className="settings-card__label">MOBILE SESSION</text><text className="settings-card__body">Cookie sessions and CSRF protection are kept compatible with the web client.</text></view>
        <Button variant="secondary" full onPress={() => refresh()}>Refresh account</Button>
        <Button variant="danger" full onPress={() => logout()}>Sign out</Button>
      </view>
    </scroll-view>
  )
}
