import { useQuery } from '@tanstack/react-query'

import { useSession } from '../auth/session.js'
import { RecordRow } from '../components/record-row.js'
import { Button, ErrorState, LoadingState, SectionTitle } from '../components/primitives.js'
import type { DashboardData, SavedRecord } from '../api/types.js'

export function HomeScreen({ onOpenCapture, onOpenVault, onOpenRecord }: {
  onOpenCapture: () => void
  onOpenVault: () => void
  onOpenRecord: (record: SavedRecord) => void
}) {
  const { api, organization, session } = useSession()
  const query = useQuery<DashboardData>({
    queryKey: ['dashboard', organization?.id],
    queryFn: api.dashboard,
    enabled: Boolean(organization),
    retry: 1,
    staleTime: 20_000,
  })

  const firstName = session?.user.name.split(' ')[0] ?? 'there'

  return (
    <scroll-view className="page-scroll" scroll-orientation="vertical">
      <view className="screen screen--home">
        <view className="topbar">
          <view>
            <text className="topbar__eyebrow">{organization?.name ?? 'Personal workspace'}</text>
            <text className="topbar__title">Hello, {firstName}</text>
          </view>
          <view className="avatar"><text>{firstName.slice(0, 1).toUpperCase()}</text></view>
        </view>

        <view className="hero-card hero-card--teal">
          <text className="hero-card__eyebrow">YOUR MEMORY, IN MOTION</text>
          <text className="hero-card__title">Keep the useful bits.</text>
          <text className="hero-card__body">Capture once, find the source, and keep every detail close.</text>
          <Button variant="on-color" onPress={onOpenCapture}>New capture</Button>
          <view className="hero-card__orb"><text>D</text></view>
        </view>

        {query.isPending ? <LoadingState label="Reading your workspace..." /> : null}
        {query.error ? <ErrorState message={query.error instanceof Error ? query.error.message : 'Dashboard unavailable.'} onRetry={() => query.refetch()} /> : null}
        {query.data ? <DashboardContent data={query.data} onOpenVault={onOpenVault} onOpenRecord={onOpenRecord} /> : null}
      </view>
    </scroll-view>
  )
}

function DashboardContent({ data, onOpenVault, onOpenRecord }: {
  data: DashboardData
  onOpenVault: () => void
  onOpenRecord: (record: SavedRecord) => void
}) {
  const summary = data.summary
  return (
    <view className="screen-content">
      <SectionTitle eyebrow="AT A GLANCE" title="The pulse of your vault" action={<view bindtap={onOpenVault}><text className="text-link">Open vault</text></view>} />
      <scroll-view className="stat-scroll" scroll-orientation="horizontal">
        <view className="stat-card stat-card--peach"><text className="stat-card__label">Saved</text><text className="stat-card__value">{summary.savedRecords}</text><text className="stat-card__hint">Items in this workspace</text></view>
        <view className="stat-card stat-card--lavender"><text className="stat-card__label">This week</text><text className="stat-card__value">{summary.savedThisWeek}</text><text className="stat-card__hint">Saved in the last 7 days</text></view>
        <view className="stat-card stat-card--pink"><text className="stat-card__label">Sources</text><text className="stat-card__value">{summary.uniqueSources}</text><text className="stat-card__hint">Websites you saved from</text></view>
      </scroll-view>
      <SectionTitle eyebrow="RECENTLY SAVED" title="Your latest memory" />
      {(data.recentRecords ?? data.recentCaptures).length ? (
        <view className="record-list">
          {(data.recentRecords ?? data.recentCaptures).slice(0, 5).map((record) => <RecordRow key={record.id} record={record} onPress={() => onOpenRecord(record)} />)}
        </view>
      ) : (
        <view className="soft-card"><text className="soft-card__title">Your vault is waiting.</text><text className="soft-card__body">Use New capture to save a page, a passage, or a link.</text></view>
      )}
    </view>
  )
}
