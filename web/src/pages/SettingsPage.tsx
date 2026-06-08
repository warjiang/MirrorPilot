import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SettingsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account &amp; Storage</CardTitle>
        <CardDescription>
          Your mirror configuration is stored in Cloudflare D1 and tied to your
          identity via Cloudflare Access SSO.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Authentication is handled automatically. Use the{' '}
          <strong>Pull</strong> and <strong>Push</strong> buttons in the header
          to sync your configuration with the cloud database.
        </p>
        <p className="text-sm text-muted-foreground">
          Theme preference is stored locally in your browser and never synced.
        </p>
      </CardContent>
    </Card>
  )
}
