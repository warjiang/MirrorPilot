// Image reference helpers, ported from the Go CLI
// (internal/cli/image_ref.go and internal/cli/image_paths.go).

const repoSegment = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const registryHost = /^(?:localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]+)?$/
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
const digestPattern = /^[A-Za-z][A-Za-z0-9]*(?:[+._-][A-Za-z][A-Za-z0-9]*)*:[0-9a-fA-F]{32,}$/

function looksLikeRegistryHost(part: string): boolean {
  return part.includes('.') || part.includes(':') || part === 'localhost'
}

/**
 * Validate a container image reference (without scheme). Returns an error
 * string, or null when the reference is valid.
 */
export function validateImageReference(raw: string): string | null {
  const ref = raw.trim()
  if (ref === '') return 'reference cannot be empty'
  if (ref.includes('://'))
    return 'must be a container image reference (without scheme)'

  let namePart = ref
  const at = ref.indexOf('@')
  if (at >= 0) {
    const digest = ref.slice(at + 1)
    if (digest === '' || !digestPattern.test(digest))
      return `invalid digest in "${raw}"`
    namePart = ref.slice(0, at)
  }

  const lastSlash = namePart.lastIndexOf('/')
  const lastColon = namePart.lastIndexOf(':')
  if (lastColon > lastSlash) {
    const tag = namePart.slice(lastColon + 1)
    if (!tagPattern.test(tag)) return `invalid tag in "${raw}"`
    namePart = namePart.slice(0, lastColon)
  }

  const parts = namePart.split('/').filter((p) => p !== '')
  if (parts.length === 0) return `invalid image name "${raw}"`
  if (parts.length === 1 && looksLikeRegistryHost(parts[0]))
    return `invalid image repository in "${raw}"`

  let start = 0
  if (parts.length > 1 && looksLikeRegistryHost(parts[0])) {
    if (!registryHost.test(parts[0]))
      return `invalid registry host in "${raw}"`
    start = 1
  }
  if (start >= parts.length) return `invalid image repository in "${raw}"`
  for (const seg of parts.slice(start)) {
    if (!repoSegment.test(seg))
      return `invalid repository segment "${seg}" in "${raw}"`
  }
  return null
}

export interface ParsedRef {
  registry: string
  repository: string
  reference: string // tag or digest value
  isDigest: boolean
  isDefaultRegistry: boolean
}

/**
 * Parse a reference into its registry / repository / tag-or-digest parts,
 * applying Docker Hub defaults (docker.io + library/ for official images).
 */
export function parseImageRef(raw: string): ParsedRef {
  let ref = raw.trim()
  let reference = 'latest'
  let isDigest = false

  const at = ref.indexOf('@')
  if (at >= 0) {
    reference = ref.slice(at + 1)
    isDigest = true
    ref = ref.slice(0, at)
  }

  const lastSlash = ref.lastIndexOf('/')
  const lastColon = ref.lastIndexOf(':')
  if (!isDigest && lastColon > lastSlash) {
    reference = ref.slice(lastColon + 1)
    ref = ref.slice(0, lastColon)
  }

  const parts = ref.split('/').filter((p) => p !== '')
  let registry = 'docker.io'
  let isDefaultRegistry = true
  let repoParts = parts
  if (parts.length > 1 && looksLikeRegistryHost(parts[0])) {
    registry = parts[0]
    isDefaultRegistry = false
    repoParts = parts.slice(1)
  }

  let repository = repoParts.join('/')
  if (isDefaultRegistry && repoParts.length === 1) {
    repository = `library/${repository}`
  }

  return { registry, repository, reference, isDigest, isDefaultRegistry }
}

/**
 * Derive the default target from a source reference, matching the Go CLI
 * behaviour documented in the README.
 */
export function deriveTarget(source: string): string {
  const parsed = parseImageRef(source)
  const tagSuffix = parsed.isDigest
    ? `@${parsed.reference}`
    : `:${parsed.reference}`

  if (parsed.isDefaultRegistry) {
    // strip the implicit library/ prefix for official images
    const repo = parsed.repository.startsWith('library/')
      ? parsed.repository.slice('library/'.length)
      : parsed.repository
    return `${repo}${tagSuffix}`
  }

  const segments = parsed.repository.split('/')
  if (segments.length >= 2) {
    const last = segments.slice(-2).join('-')
    return `${last}${tagSuffix}`
  }
  return `${parsed.repository}${tagSuffix}`
}

/** Build the fully-qualified target image from a registry + target path. */
export function buildFullTarget(registry: string, target: string): string {
  const reg = registry.replace(/\/+$/, '').trim()
  const t = target.replace(/^\/+/, '').trim()
  if (reg === '') return t
  if (t === '') return reg
  return `${reg}/${t}`
}
