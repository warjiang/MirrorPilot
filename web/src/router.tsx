import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { LandingPage } from '@/pages/LandingPage'
import { MirrorsPage } from '@/pages/MirrorsPage'
import { ProfilesPage } from '@/pages/ProfilesPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { AuthGuard } from '@/components/AuthGuard'
import { useCloudflareStorage } from '@/hooks/useCloudflareStorage'

export function AppRouter() {
  const { config, setConfig, loading, syncing, error, load } =
    useCloudflareStorage()

  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<LandingPage />} />
        <Route
          element={
            <AuthGuard>
              {() => (
                <AppLayout
                  loading={loading}
                  syncing={syncing}
                  error={error}
                />
              )}
            </AuthGuard>
          }
        >
          <Route
            path="mirrors"
            element={<MirrorsPage config={config} setConfig={setConfig} reloadConfig={load} />}
          />
          <Route
            path="profiles"
            element={
              <ProfilesPage
                config={config}
                setConfig={setConfig}
              />
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
