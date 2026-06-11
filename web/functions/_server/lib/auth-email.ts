const CODE_LENGTH = 6
const CODE_TTL_MINUTES = 10

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function escapeHtml(value: string) {
  return value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')
}

export function normalizeEmail(email: string) {
  return email.toLowerCase().trim()
}

export function generateVerificationCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 10 ** CODE_LENGTH
  return value.toString().padStart(CODE_LENGTH, '0')
}

export async function hashVerificationCode(email: string, code: string) {
  const data = new TextEncoder().encode(`${normalizeEmail(email)}:${code}`)
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

export function getVerificationExpiry() {
  return new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)
}

export function getVerificationTtlMinutes() {
  return CODE_TTL_MINUTES
}

export function buildVerificationEmail(options: {
  appName: string
  email: string
  code: string
  ttlMinutes: number
}) {
  const { appName, email, code, ttlMinutes } = options
  const subject = `${appName} verification code`
  const text = [
    `Your ${appName} verification code is ${code}.`,
    `It expires in ${ttlMinutes} minutes.`,
    `This request was sent for ${email}.`,
    'If you did not request this code, you can ignore this email.',
  ].join('\n\n')

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6">
      <h1 style="margin:0 0 16px">Your ${escapeHtml(appName)} verification code</h1>
      <p>Your verification code is <strong style="font-size:24px;letter-spacing:0.08em">${code}</strong>.</p>
      <p>It expires in ${ttlMinutes} minutes.</p>
      <p>This request was sent for <strong>${escapeHtml(email)}</strong>.</p>
      <p>If you did not request this code, you can ignore this email.</p>
    </div>
  `.trim()

  return { subject, text, html }
}
