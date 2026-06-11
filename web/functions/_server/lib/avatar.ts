/**
 * Deterministic default avatar for users without one.
 * Uses DiceBear (free, no auth) seeded by the user's email so each
 * user always gets the same randomly-styled avatar.
 */
export function defaultAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(seed.toLowerCase().trim())}`
}
