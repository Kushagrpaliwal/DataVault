import { useEffect, useState } from '@lynx-js/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useSession } from '../auth/session.js'
import type { SavedRecord } from '../api/types.js'
import { RecordRow } from '../components/record-row.js'
import { Button, EmptyState, ErrorState, LoadingState, SectionTitle, TextInput } from '../components/primitives.js'

type VaultFilter = 'inbox' | 'archived' | 'trash'

export function VaultScreen({ onOpenRecord }: { onOpenRecord: (record: SavedRecord) => void }) {
  const { api, organization } = useSession()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<VaultFilter>('inbox')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 260)
    return () => clearTimeout(timer)
  }, [search])

  const query = useQuery({
    queryKey: ['records', organization?.id, filter, debouncedSearch],
    queryFn: () => api.listSavedRecords({
      page: 1,
      limit: 25,
      q: debouncedSearch,
      archived: filter === 'archived',
      trash: filter === 'trash',
      sort: 'createdAt',
      direction: 'desc',
    }),
    enabled: Boolean(organization),
    retry: 1,
  })

  const archive = useMutation({
    mutationFn: (record: SavedRecord) => record.archivedAt ? api.restoreSavedRecord(record.id) : api.archiveSavedRecord(record.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['records'] }),
  })
  const trash = useMutation({
    mutationFn: (record: SavedRecord) => api.deleteSavedRecord(record.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['records'] }),
  })
  const restore = useMutation({
    mutationFn: (record: SavedRecord) => api.restoreTrashedRecord(record.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['records'] }),
  })

  return (
    <scroll-view className="page-scroll" scroll-orientation="vertical">
      <view className="screen">
        <SectionTitle eyebrow="THE VAULT" title="Everything worth keeping" />
        <view className="search-box"><text className="search-box__icon">?</text><TextInput value={search} onChange={setSearch} placeholder="Search titles, text, or domains" /></view>
        <scroll-view className="filter-scroll" scroll-orientation="horizontal">
          <FilterChip label="Inbox" active={filter === 'inbox'} onPress={() => setFilter('inbox')} />
          <FilterChip label="Archived" active={filter === 'archived'} onPress={() => setFilter('archived')} />
          <FilterChip label="Trash" active={filter === 'trash'} onPress={() => setFilter('trash')} />
        </scroll-view>
        {query.isPending ? <LoadingState label="Opening your vault..." /> : null}
        {query.error ? <ErrorState message={query.error instanceof Error ? query.error.message : 'Vault unavailable.'} onRetry={() => query.refetch()} /> : null}
        {query.data?.items.length ? (
          <view className="record-list">
            {query.data.items.map((record) => (
              <view key={record.id} className="record-stack">
                <RecordRow record={record} onPress={() => onOpenRecord(record)} />
                <view className="record-actions">
                  {filter === 'trash' ? <Button variant="ghost" onPress={() => restore.mutate(record)}>Restore</Button> : <Button variant="ghost" onPress={() => archive.mutate(record)}>{record.archivedAt ? 'Restore' : 'Archive'}</Button>}
                  {filter !== 'trash' ? <Button variant="ghost" onPress={() => trash.mutate(record)}>Move to trash</Button> : null}
                </view>
              </view>
            ))}
          </view>
        ) : null}
        {query.data && query.data.items.length === 0 ? <EmptyState title="Nothing here yet" body={filter === 'trash' ? 'Deleted captures will stay here until you restore them.' : 'Save a note or capture and it will appear here.'} /> : null}
      </view>
    </scroll-view>
  )
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <view className={`filter-chip${active ? ' filter-chip--active' : ''}`} bindtap={onPress}><text>{label}</text></view>
}
