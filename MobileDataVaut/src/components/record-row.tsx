import type { SavedRecord } from '../api/types.js'
import { Badge } from './primitives.js'

function recordTypeLabel(type: string) {
  return type.replaceAll('_', ' ')
}

export function RecordRow({ record, onPress }: { record: SavedRecord; onPress: () => void }) {
  return (
    <view className="record-row" bindtap={onPress}>
      <view className={`record-row__mark record-row__mark--${record.recordType}`}>
        <text>{record.recordType.slice(0, 1).toUpperCase()}</text>
      </view>
      <view className="record-row__content">
        <view className="record-row__topline">
          <text className="record-row__title">{record.title}</text>
          <text className="record-row__date">{formatDate(record.capturedAt ?? record.createdAt)}</text>
        </view>
        <text className="record-row__snippet">{record.originalText ?? record.sourceDomain ?? 'Saved in your vault'}</text>
        <view className="record-row__meta">
          <Badge tone={record.archivedAt ? 'warning' : 'teal'}>{record.archivedAt ? 'Archived' : recordTypeLabel(record.recordType)}</Badge>
          {record.sourceDomain ? <text className="record-row__domain">{record.sourceDomain}</text> : null}
        </view>
      </view>
      <text className="record-row__arrow">&gt;</text>
    </view>
  )
}

export function formatDate(value: string | null) {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(date)
}

export function formatMoney(value: string | null | undefined, currency = 'INR') {
  if (!value) return '--'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return `${currency} ${value}`
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}
