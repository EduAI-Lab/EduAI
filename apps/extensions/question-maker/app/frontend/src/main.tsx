/**
 * Frontend entrypoint: applies global styles, theme provider, and mounts the React app.
 * Wraps App with ThemeProvider so routing and pages inherit the selected theme.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ThemeProvider } from './components/theme-provider'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider defaultTheme="light" storageKey="eduquery-theme">
            <App />
        </ThemeProvider>
    </React.StrictMode>,
) 
