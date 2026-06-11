import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { LandingPage } from '@/pages/LandingPage'
import { MirrorsPage } from '@/pages/MirrorsPage'
import { JobsPage } from '@/pages/JobsPage'
import { ProfilesPage } from '@/pages/ProfilesPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { AdminPage } from '@/pages/AdminPage'
import { AuthGuard } from '@/components/AuthGuard'
import { RequireAdmin } from '@/components/RequireAdmin'
import { useCloudflareStorage } from '@/hooks/useCloudflareStorage'

export function AppRouter() {
  const { config, setConfig, loading, syncing, error, lastSavedAt } =
    useCloudflareStorage()

  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<LandingPage />} />
        <Route
          element={
            <AuthGuard>
              {({ user, logout }) => (
                <AppLayout
                  loading={loading}
                  syncing={syncing}
                  error={error}
                  user={user}
                  onLogout={logout}
                />
              )}
            </AuthGuard>
          }
        >
          <Route
            path="mirrors"
            element={<MirrorsPage config={config} setConfig={setConfig} loading={loading} lastSavedAt={lastSavedAt} />}
          />
          <Route
            path="profiles"
            element={
              <RequireAdmin>
                <ProfilesPage
                  config={config}
                  setConfig={setConfig}
                />
              </RequireAdmin>
            }
          />
          <Route path="jobs" element={<JobsPage />} />
          <Route
            path="settings"
            element={
              <RequireAdmin>
                <SettingsPage />
              </RequireAdmin>
            }
          />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
