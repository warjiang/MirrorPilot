# Product

## Register

product

## Users

DevOps engineers, individual developers, and anyone who needs to pull container images but is limited by network restrictions (firewalls, GFW, slow international links). They use MirrorPilot to configure, sync, and monitor image mirrors from a web dashboard or CLI — typically on a workstation or CI environment during setup/maintenance windows.

## Product Purpose

MirrorPilot makes container image mirroring effortless. Users declare source images, and the tool handles syncing them to private registries they control. The web UI provides instant visibility into sync status, source detection, and registry health — reducing what was a manual, error-prone scripting task into a managed workflow. Success looks like: a developer adds an image source in under 10 seconds and knows immediately whether it synced.

## Brand Personality

Precise, efficient, trustworthy.

## Anti-references

- Cluttered Docker Hub interface with ads and upsells
- Overly corporate enterprise dashboards (heavy sidebars, deep navigation trees)
- Generic SaaS admin templates with card-grid metrics
- Portainer's density without its clarity (busy toolbars, small text everywhere)

## Design Principles

1. **Instant legibility** — Status, health, and errors are visible at a glance without clicking into detail views.
2. **Keyboard-first efficiency** — Power users manage dozens of images; the UI respects their speed.
3. **Quiet confidence** — The tool looks capable without shouting. Visual noise is minimized so signals stand out.
4. **Progressive disclosure** — Simple tasks stay simple; advanced config reveals itself only when needed.
5. **Zero-ambiguity states** — Every image entry clearly communicates synced/pending/failed without relying on color alone.

## Accessibility & Inclusion

WCAG AA compliance. Sufficient contrast ratios (4.5:1 text, 3:1 UI components). Status communicated through icon + text, not color alone. Reduced motion respected via `prefers-reduced-motion`. Keyboard navigation for all interactive elements.
