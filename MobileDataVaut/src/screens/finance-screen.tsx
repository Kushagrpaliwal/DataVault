import { useState } from '@lynx-js/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useSession } from '../auth/session.js'
import type { PaymentInput } from '../api/types.js'
import { formatMoney } from '../components/record-row.js'
import { Button, EmptyState, ErrorState, Field, LoadingState, SectionTitle, TextInput } from '../components/primitives.js'

export function FinanceScreen() {
  const { api, organization } = useSession()
  const client = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const payments = useQuery({
    queryKey: ['payments', organization?.id],
    queryFn: () => api.listPayments({ page: 1, limit: 20, archived: false }),
    enabled: Boolean(organization),
    retry: 1,
  })
  const invoices = useQuery({
    queryKey: ['invoices', organization?.id],
    queryFn: () => api.listInvoices({ page: 1, limit: 8, archived: false }),
    enabled: Boolean(organization),
    retry: 1,
  })
  const createPayment = useMutation({
    mutationFn: (body: PaymentInput) => api.createPayment(body),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['payments'] })
      await client.invalidateQueries({ queryKey: ['dashboard'] })
      setAmount('')
      setDescription('')
      setShowForm(false)
      setError(null)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Payment could not be saved.'),
  })

  const submit = () => {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
      setError('Enter an amount with up to two decimal places.')
      return
    }
    createPayment.mutate({
      direction,
      amount: amount.trim(),
      currency: organization?.currency ?? 'INR',
      paymentDate: new Date().toISOString().slice(0, 10),
      description: description.trim() || undefined,
    })
  }

  const paymentItems = payments.data?.items ?? []
  const invoiceItems = invoices.data?.items ?? []

  return (
    <scroll-view className="page-scroll" scroll-orientation="vertical">
      <view className="screen">
        <SectionTitle eyebrow="FINANCE" title="Money with context" action={<Button onPress={() => setShowForm(!showForm)}>{showForm ? 'Close' : 'Add payment'}</Button>} />
        {showForm ? <view className="form-card form-card--accent"><text className="form-card__title">Record a payment</text><view className="direction-row"><view className={`direction-chip${direction === 'incoming' ? ' direction-chip--active' : ''}`} bindtap={() => setDirection('incoming')}><text>Incoming</text></view><view className={`direction-chip${direction === 'outgoing' ? ' direction-chip--active' : ''}`} bindtap={() => setDirection('outgoing')}><text>Outgoing</text></view></view><Field label="Amount"><TextInput value={amount} onChange={setAmount} placeholder="0.00" type="number" /></Field><Field label="Description"><TextInput value={description} onChange={setDescription} placeholder="What was this for?" /></Field>{error ? <text className="form-error">{error}</text> : null}<Button full onPress={submit} disabled={createPayment.isPending}>{createPayment.isPending ? 'Saving...' : 'Save payment'}</Button></view> : null}
        {payments.isPending ? <LoadingState label="Reading payments..." /> : null}
        {payments.error ? <ErrorState message={payments.error instanceof Error ? payments.error.message : 'Payments unavailable.'} onRetry={() => payments.refetch()} /> : null}
        <view className="finance-band"><view><text className="finance-band__label">OUTSTANDING INVOICES</text><text className="finance-band__value">{invoices.isPending ? '...' : invoiceItems.length}</text><text className="finance-band__body">Open items across this workspace</text></view><text className="finance-band__mark">IN</text></view>
        <SectionTitle eyebrow="PAYMENTS" title="Recent movement" />
        {paymentItems.length ? <view className="finance-list">{paymentItems.map((item, index) => <PaymentRow key={String(item.id ?? index)} item={item} />)}</view> : <EmptyState title="No payments yet" body="Record the first incoming or outgoing payment to start your financial timeline." />}
        <SectionTitle eyebrow="INVOICES" title="Open paperwork" />
        {invoiceItems.length ? <view className="finance-list">{invoiceItems.map((item, index) => <InvoiceRow key={String(item.id ?? index)} item={item} />)}</view> : <view className="soft-card"><text className="soft-card__title">No invoices in view.</text><text className="soft-card__body">Invoice workflows remain available through the shared backend and can be expanded here next.</text></view>}
      </view>
    </scroll-view>
  )
}

function PaymentRow({ item }: { item: Record<string, unknown> }) {
  const direction = String(item.direction ?? 'incoming')
  return <view className="finance-row"><view className={`finance-row__mark finance-row__mark--${direction}`}><text>{direction === 'incoming' ? '+' : '-'}</text></view><view className="finance-row__content"><text className="finance-row__title">{String(item.description ?? item.paymentNumber ?? 'Payment')}</text><text className="finance-row__body">{String(item.paymentDate ?? 'No date')} - {String(item.status ?? 'pending')}</text></view><text className="finance-row__amount">{direction === 'outgoing' ? '-' : '+'}{formatMoney(String(item.amount ?? '0'), String(item.currency ?? 'INR'))}</text></view>
}

function InvoiceRow({ item }: { item: Record<string, unknown> }) {
  return <view className="finance-row"><view className="finance-row__mark finance-row__mark--invoice"><text>IN</text></view><view className="finance-row__content"><text className="finance-row__title">{String(item.invoiceNumber ?? item.title ?? 'Invoice')}</text><text className="finance-row__body">Due {String(item.dueDate ?? 'no date')} - {String(item.status ?? 'draft')}</text></view><text className="finance-row__amount">{formatMoney(String(item.total ?? item.amount ?? '0'), String(item.currency ?? 'INR'))}</text></view>
}
