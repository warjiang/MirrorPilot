# MirrorPilot Agent Notes

## Must-Run Checks

When changing code under `web/`, run these checks before finishing:

```bash
pnpm -C web lint
pnpm -C web build
```

Fix lint errors before committing. Warnings may be kept only when explicitly accepted.
