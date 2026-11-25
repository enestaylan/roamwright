# Contributing to Roamwright

Use the [issue tracker](https://github.com/enestaylan/roamwright/issues) for bugs and feature requests. For a rendering bug, a seed, a short reproduction and the Roamwright, Three.js and browser versions help other contributors recreate the scene. Send security-sensitive reports through [GitHub Security Advisories](https://github.com/enestaylan/roamwright/security/advisories/new).

## Set up and test

Use Node.js 24 to match CI, npm, and Python 3 for the local HTTP server. From the repository root, run the following commands.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run test:package
```

| Command | What it checks |
| --- | --- |
| `npm test` | Seeded generation, geometry buffers, player motion and worker/runtime behavior. |
| `npm run test:browser` | GPU batching, post-processing, and both examples rendered with two seeds in Chromium. Set `CHROMIUM_EXECUTABLE` to use an existing Chrome executable. |
| `npm run test:package` | Packs the working tree, installs the tarball and the selected Three.js revision into a temporary project, and builds geometry through public imports. |
| `npm run demo` | Serves the [alpine viaduct](http://localhost:8080/examples/viaduct.html?seed=42) and [seeded island](http://localhost:8080/examples/) for interactive inspection. |

CI runs the first three checks with Three.js 0.170.0 and 0.187.0. To try the older peer locally, run `npm install --no-save --package-lock=false three@0.170.0` and repeat the checks. Run `npm ci` to restore the locked dependencies.

## Prepare a pull request

- Keep application content in the consumer. Pass in the seed, terrain function, camera, materials or callbacks a reusable module needs.
- Show new public behavior with a focused test or a small example. For rendering changes, compare the same scene before and after and record draw counts. For motion or geometry, compare deterministic state or buffers.
- Update the README for public API changes. For a new Three.js revision, update the peer range, lockfile, compatibility notes and CI matrix together.
- Include the source and license of adapted components in `licenses/`. Review `npm pack --dry-run` when changing the published file list.

## Maintainer releases

Push tested changes as they are ready. Batch routine GitHub and npm releases into at most one per day. Check the latest registry version, its publication date and the commits since its tag before preparing a release. To try development code between releases, install a local tarball in a separate consumer checkout or pin a full Git commit SHA.

1. Choose an unused semantic version. Update the manifest and lockfile together with `npm version --no-git-tag-version patch` (or use `minor` or `major`).
2. Run the compatibility checks above, inspect `npm pack --dry-run`, and exercise the changed path in a consumer.
3. Commit on top of current `main`, create an annotated `v<version>` tag, and push the commit and tag atomically.
4. From the tagged checkout, run `npm pack`. Create the GitHub release with that tarball attached and publish the same tarball using `npm publish ./<tarball>.tgz --access public`.
5. Verify the release and the exact version's registry integrity with `npm view roamwright@<version> dist.integrity`. In a clean consumer, install that version and exercise the changed path.
