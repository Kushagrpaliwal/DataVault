import type { ReactNode } from '@lynx-js/react'

export function Button({
  children,
  onPress,
  variant = 'primary',
  disabled = false,
  full = false,
}: {
  children: ReactNode
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'on-color'
  disabled?: boolean
  full?: boolean
}) {
  return (
    <view
      className={`button button--${variant}${disabled ? ' button--disabled' : ''}${full ? ' button--full' : ''}`}
      bindtap={disabled ? undefined : onPress}
    >
      <text className="button__text">{children}</text>
    </view>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: 'text' | 'password' | 'number' | 'email'
}) {
  return (
    <input
      className="text-input"
      value={value}
      type={type}
      placeholder={placeholder}
      bindinput={(event) => onChange(event.detail.value)}
    />
  )
}

export function TextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <textarea
      className="text-area"
      value={value}
      placeholder={placeholder}
      bindinput={(event) => onChange(event.detail.value)}
    />
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <view className="field">
      <text className="field__label">{label}</text>
      {children}
      {hint ? <text className="field__hint">{hint}</text> : null}
    </view>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'teal' | 'pink' | 'warning' }) {
  return <text className={`badge badge--${tone}`}>{children}</text>
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <view className="section-title">
      <view>
        {eyebrow ? <text className="section-title__eyebrow">{eyebrow}</text> : null}
        <text className="section-title__title">{title}</text>
      </view>
      {action ? <view className="section-title__action">{action}</view> : null}
    </view>
  )
}

export function LoadingState({ label = 'Loading DataVault...' }: { label?: string }) {
  return (
    <view className="state-card state-card--loading">
      <text className="state-card__mark">...</text>
      <text className="state-card__title">{label}</text>
    </view>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <view className="state-card state-card--error">
      <text className="state-card__mark">!</text>
      <text className="state-card__title">Something needs attention</text>
      <text className="state-card__body">{message}</text>
      {onRetry ? <Button variant="secondary" onPress={onRetry}>Try again</Button> : null}
    </view>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <view className="state-card">
      <text className="state-card__mark">+</text>
      <text className="state-card__title">{title}</text>
      <text className="state-card__body">{body}</text>
      {action ? <view className="state-card__action">{action}</view> : null}
    </view>
  )
}

export function Divider() {
  return <view className="divider" />
}
