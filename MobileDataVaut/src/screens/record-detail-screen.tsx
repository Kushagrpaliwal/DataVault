import { useEffect, useState } from '@lynx-js/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { open } from 'sparkling-navigation'

import { useSession } from '../auth/session.js'
import { formatDate } from '../components/record-row.js'
import { Badge, Button, Divider, ErrorState, Field, LoadingState, SectionTitle, TextArea, TextInput } from '../components/primitives.js'

export function RecordDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const { api, organization } = useSession()
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const query = useQuery({ queryKey: ['record', organization?.id, id], queryFn: () => api.getSavedRecord(id), enabled: Boolean(id) })

  useEffect(() => {
    if (!query.data) return
    setTitle(query.data.title)
    setDescription(query.data.description ?? '')
  }, [query.data?.id])

  const save = useMutation({
    mutationFn: () => api.updateSavedRecord(id, { title: title.trim(), description: description.trim() }),
    onSuccess: async () => {
      setEditing(false)
      await client.invalidateQueries({ queryKey: ['record', organization?.id, id] })
      await client.invalidateQueries({ queryKey: ['records'] })
    },
  })
  const archive = useMutation({
    mutationFn: () => query.data?.archivedAt ? api.restoreSavedRecord(id) : api.archiveSavedRecord(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['record', organization?.id, id] }),
  })
  const trash = useMutation({
    mutationFn: () => api.deleteSavedRecord(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['records'] })
      onBack()
    },
  })

  return (
    <scroll-view className="page-scroll" scroll-orientation="vertical">
      <view className="screen">
        <view className="back-link" bindtap={onBack}><text>&lt; Back to vault</text></view>
        {query.isPending ? <LoadingState label="Opening record..." /> : null}
        {query.error ? <ErrorState message={query.error instanceof Error ? query.error.message : 'Record unavailable.'} onRetry={() => query.refetch()} /> : null}
        {query.data ? <view className="detail-stack">
          <view className="detail-card detail-card--lavender"><view className="detail-card__top"><Badge tone="neutral">{query.data.recordType}</Badge><text className="detail-card__date">{formatDate(query.data.createdAt)}</text></view>{editing ? <view className="detail-edit"><TextInput value={title} onChange={setTitle} placeholder="Title" /><TextArea value={description} onChange={setDescription} placeholder="Description" /></view> : <view><text className="detail-card__title">{query.data.title}</text>{query.data.description ? <text className="detail-card__body">{query.data.description}</text> : null}</view>}<view className="detail-actions">{editing ? <Button onPress={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save'}</Button> : <Button variant="secondary" onPress={() => setEditing(true)}>Edit</Button>}<Button variant="ghost" onPress={() => archive.mutate()}>{query.data.archivedAt ? 'Restore' : 'Archive'}</Button>{!query.data.deletedAt ? <Button variant="danger" onPress={() => trash.mutate()}>Trash</Button> : null}</view></view>
          {query.data.originalText ? <view className="detail-card"><SectionTitle eyebrow="PRESERVED TEXT" title="Original capture" /><text className="captured-text">{query.data.originalText}</text></view> : null}
          <view className="detail-card detail-card--teal"><SectionTitle eyebrow="SOURCE CONTEXT" title="Where it came from" /><Field label="Domain"><text className="detail-value detail-value--inverse">{query.data.sourceDomain ?? 'Manual entry'}</text></Field><Field label="Captured"><text className="detail-value detail-value--inverse">{formatDate(query.data.capturedAt ?? query.data.createdAt)}</text></Field>{query.data.sourceUrl ? <Button variant="on-color" onPress={() => open({ scheme: query.data.sourceUrl!, options: { useSysBrowser: true } }, () => {})}>Open source</Button> : null}</view>
          {query.data.evidence.length ? <view className="detail-card"><SectionTitle eyebrow="EVIDENCE TRAIL" title="Verified context" />{query.data.evidence.map((evidence) => <view key={evidence.id} className="evidence-row"><text className="evidence-row__title">{evidence.sourceTitle ?? evidence.sourceDomain ?? 'Evidence snapshot'}</text><text className="evidence-row__hash">SHA-256 {evidence.contentHash}</text><text className="evidence-row__date">Captured {formatDate(evidence.capturedAt)}</text></view>)}</view> : null}
          <view className="detail-card"><SectionTitle eyebrow="ACTIVITY" title="Record history" />{query.data.audit.length ? query.data.audit.slice(0, 8).map((entry, index) => <view key={String(entry.id ?? index)} className="audit-row"><view className="audit-row__dot" /><view><text className="audit-row__title">{String(entry.action ?? 'Updated')} {String(entry.resourceType ?? 'record')}</text><text className="audit-row__date">{formatDate(String(entry.createdAt ?? query.data?.updatedAt))}</text></view></view>) : <text className="muted-text">No activity yet.</text>}<Divider /><text className="muted-text">{query.data.attachments.length} attachment(s) - {query.data.tags.length} tag(s) - {query.data.collections.length} collection(s)</text></view>
        </view> : null}
      </view>
    </scroll-view>
  )
}
