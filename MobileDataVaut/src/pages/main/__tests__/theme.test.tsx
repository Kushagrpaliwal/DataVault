import '@testing-library/jest-dom'
import { expect, test } from 'vitest'
import { act, fireEvent, getQueriesForElement, render } from '@lynx-js/react/testing-library'

import { ThemeProvider, useTheme } from '../../../theme.js'
import { ThemeToggle } from '../../../components/theme-toggle.js'

/**
 * The theme as it is on the screen.
 */
function Probe() {
  const { theme, resolved } = useTheme()
  return <text className="probe">{`${theme}:${resolved}`}</text>
}

function shown(root: HTMLElement) {
  return getQueriesForElement(root).getByText(/:/)
}

test('the button in the bar turns the theme over', async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
      <Probe />
    </ThemeProvider>,
  )

  const root = elementTree.root! as HTMLElement
  await act(async () => { await Promise.resolve() })
  expect(shown(root)).toHaveTextContent('system:light')

  const toggle = root.querySelector('.theme-toggle')
  expect(toggle).toBeTruthy()

  await act(async () => { fireEvent.tap(toggle!) })
  expect(shown(root)).toHaveTextContent('dark:dark')

  await act(async () => { fireEvent.tap(root.querySelector('.theme-toggle')!) })
  expect(shown(root)).toHaveTextContent('light:light')
})

test('a choice made while the stored one is being read is the one that is kept', async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
      <Probe />
    </ThemeProvider>,
  )

  const root = elementTree.root! as HTMLElement
  await act(async () => { fireEvent.tap(root.querySelector('.theme-toggle')!) })
  expect(shown(root)).toHaveTextContent('dark:dark')
})
