import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./components/feedback";
import { applyTheme, storedTheme, watchSystemTheme } from "./lib/theme";
import { App } from "./App";
import "./index.css";

/**
 * The theme is put on before the page is drawn, so that the colours do not
 * change in front of the reader.
 */
applyTheme(storedTheme());
watchSystemTheme();

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: true }, mutations: { retry: 0 } } });

createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><AuthProvider><ToastProvider><App/></ToastProvider></AuthProvider></BrowserRouter></QueryClientProvider></StrictMode>);

if (import.meta.env.PROD && "serviceWorker" in navigator) void navigator.serviceWorker.register("/service-worker.js");
