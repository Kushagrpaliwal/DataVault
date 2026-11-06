import { root } from '@lynx-js/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App.js'
import { SessionProvider } from '../../auth/session.js'
import { ThemeProvider } from '../../theme.js'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

root.render(
  <QueryClientProvider client={queryClient}>
    <SessionProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </SessionProvider>
  </QueryClientProvider>,
)

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept()
}
