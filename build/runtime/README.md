Bundled runtime assets live here.

Expected layout:

- `<target>/bin/node`
- `<target>/bin/npm`
- `<target>/bin/corepack`
- `<target>/bin/pnpm`
- `<target>/bin/yarn`
- `<target>/bin/bun`

Optional runtime packs:

- `packs/<target>/runtime-pack-python-<target>.tar.gz`
- `packs/<target>/runtime-pack-rust-<target>.tar.gz`
- `packs/<target>/runtime-pack-go-<target>.tar.gz`

Manifest and signatures:

- `manifest.json`
- `runtime-manifest.sig`
- `capability-catalog.json`
- `capability-catalog.sig`
- `runtime-public-key.pem`

Use scripts:

- `npm run prepare:bundled-runtimes`
- `npm run prepare:runtime-pack-sources`
- `npm run prepare:runtime-pack-sources:check`
- `npm run build:runtime-packs`
- `npm run sign:runtime-manifest`
