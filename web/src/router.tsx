import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { MirrorsPage } from '@/pages/MirrorsPage'
import { ProfilesPage } from '@/pages/ProfilesPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { useGitHubSettings, useGitHubStorage } from '@/hooks/useGitHubStorage'
import { useState } from 'react'
import type { Credentials } from '@/components/EntriesTable'

export function AppRouter() {
  const [ghSettings, setGhSettings] = useGitHubSettings()
  const { config, setConfig, loading, syncing, error, load, save } =
    useGitHubStorage(ghSettings)
  const [credentials, setCredentials] = useState<Record<string, Credentials>>({})

  return (
    <BrowserRouter>
      <Routes>
        <Route
          element={
            <AppLayout
              loading={loading}
              syncing={syncing}
              error={error}
              ghConfigured={!!ghSettings}
              onSync={save}
              onLoad={load}
            />
          }
        >
          <Route index element={<Navigate to="/mirrors" replace />} />
          <Route
            path="mirrors"
            element={
              <MirrorsPage
                config={config}
                setConfig={setConfig}
              />
            }
          />
          <Route
            path="profiles"
            element={
              <ProfilesPage
                config={config}
                setConfig={setConfig}
                credentials={credentials}
                setCredentials={setCredentials}
              />
            }
          />
          <Route
            path="settings"
            element={
              <SettingsPage
                settings={ghSettings}
                onSave={setGhSettings}
              />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
