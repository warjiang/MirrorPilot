import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { LandingPage } from '@/pages/LandingPage'
import { ImagesPage } from '@/pages/ImagesPage'
import { JobsPage } from '@/pages/JobsPage'
import { ProfilesPage } from '@/pages/ProfilesPage'
import { AdminPage } from '@/pages/AdminPage'
import { AuthGuard } from '@/components/AuthGuard'
import { RequireAdmin } from '@/components/RequireAdmin'
import { useCloudflareStorage } from '@/hooks/useCloudflareStorage'

export function AppRouter() {
  const { config, savedConfig, setConfig, loading, error, load, lastSavedAt, markSaved } =
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
                  error={error}
                  user={user}
                  onLogout={logout}
                />
              )}
            </AuthGuard>
          }
        >
          <Route
            path="images"
            element={
              <ImagesPage
                config={config}
                savedConfig={savedConfig}
                setConfig={setConfig}
                reloadFromServer={load}
                markSaved={markSaved}
                loading={loading}
                lastSavedAt={lastSavedAt}
              />
            }
          />
          <Route path="mirrors" element={<Navigate to="/images" replace />} />
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
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
