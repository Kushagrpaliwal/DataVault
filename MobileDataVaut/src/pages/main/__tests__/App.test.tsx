import '@testing-library/jest-dom'
import { expect, test, vi } from 'vitest'
import { render, getQueriesForElement } from '@lynx-js/react/testing-library'

import { Button } from '../../../components/primitives.js'

test('Clay buttons render their action label', async () => {
  const onPress = vi.fn()

  render(<Button onPress={onPress}>New capture</Button>)

  const { findByText } = getQueriesForElement(elementTree.root!)
  const label = await findByText('New capture')
  expect(label).toBeInTheDocument()
})
