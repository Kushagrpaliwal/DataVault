import { useState } from '@lynx-js/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSession } from '../auth/session.js'
import { Button, Field, SectionTitle, TextArea, TextInput } from '../components/primitives.js'

export function CaptureScreen({ onSaved }: { onSaved: () => void }) {
  const { api } = useSession()
  const client = useQueryClient()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [recordType, setRecordType] = useState('note')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api.createSavedRecord({
      recordType,
      title: title.trim() || 'Untitled capture',
      originalText: text.trim() || undefined,
      sourceType: 'manual',
      captureKind: 'note',
      reviewStatus: 'inbox',
      privacyLevel: 'private',
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['records'] })
      await client.invalidateQueries({ queryKey: ['dashboard'] })
      setTitle('')
      setText('')
      setMessage('Saved to your vault.')
      setError(null)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The capture could not be saved.'),
  })

  const submit = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await save.mutateAsync()
    } catch {
      // The mutation renders the server error inline.
    } finally {
      setBusy(false)
    }
  }

  return (
    <scroll-view className="page-scroll" scroll-orientation="vertical">
      <view className="screen">
        <SectionTitle eyebrow="CAPTURE" title="Put it somewhere safe" />
        <view className="capture-intro"><text className="capture-intro__title">A small note now saves a big search later.</text><text className="capture-intro__body">This manual capture uses the same saved-record system as the browser extension.</text></view>
        <view className="form-card">
          <Field label="What is this?"><TextInput value={title} onChange={setTitle} placeholder="e.g. Payment confirmation from Acme" /></Field>
          <Field label="Memory"><TextArea value={text} onChange={setText} placeholder="Paste the useful text, context, or next step..." /></Field>
          <Field label="Type"><scroll-view className="type-scroll" scroll-orientation="horizontal"><TypeChip label="Article" value="article" active={recordType === 'article'} onPress={setRecordType} /><TypeChip label="Quote" value="quote" active={recordType === 'quote'} onPress={setRecordType} /><TypeChip label="Statistic" value="statistic" active={recordType === 'statistic'} onPress={setRecordType} /><TypeChip label="Note" value="note" active={recordType === 'note'} onPress={setRecordType} /><TypeChip label="Link" value="bookmark" active={recordType === 'bookmark'} onPress={setRecordType} /></scroll-view></Field>
          {error ? <text className="form-error">{error}</text> : null}
          {message ? <text className="form-notice">{message}</text> : null}
          <Button full onPress={submit} disabled={busy}>{busy ? 'Saving...' : 'Save to vault'}</Button>
        </view>
        <view className="capture-tip"><text className="capture-tip__label">NEXT UP</text><text className="capture-tip__title">Photo and document capture</text><text className="capture-tip__body">The native camera and attachment flow will upload evidence to the same record once media permissions are configured.</text></view>
        <Button variant="secondary" full onPress={onSaved}>Return to overview</Button>
      </view>
    </scroll-view>
  )
}

function TypeChip({ label, value, active, onPress }: { label: string; value: string; active: boolean; onPress: (value: string) => void }) {
  return <view className={`type-chip${active ? ' type-chip--active' : ''}`} bindtap={() => onPress(value)}><text>{label}</text></view>
}
