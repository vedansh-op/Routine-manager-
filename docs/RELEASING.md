# Publishing ONE-OS releases

ONE-OS uses versioned GitHub Releases for installable Android builds.

## What gets published

For each version tag such as `v1.2.0`, GitHub Actions:

1. Checks out the exact tagged source.
2. Runs TypeScript validation and the local recovery test suite.
3. Sets the Android app version from the tag.
4. Builds a standalone Android debug APK with its JavaScript bundle embedded.
5. Calculates a SHA-256 checksum for the APK.
6. Attaches both files to a GitHub Release and keeps a 90-day workflow artifact copy.

The GitHub Release is the long-term download location. Workflow artifacts are only a secondary copy and expire after 90 days.

## How to publish an update

1. Finish and review the changes on the feature branch.
2. Merge the approved pull request into `main`.
3. Choose the next version:
   - patch (for fixes): `v1.0.1`
   - minor (for backward-compatible features): `v1.1.0`
   - major (for a major product milestone): `v2.0.0`
4. Create and push that tag from the merged commit:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
5. Wait for **Publish ONE-OS Android release** to finish successfully. The release page will contain the APK, checksum, and GitHub-generated change summary.

Do not tag an unreviewed feature branch. A release is published only from a version tag, not from every intermediate commit.

## Important build status

The attached APK is a standalone **debug/test build** signed with the Android debug key. It is suitable for installing and testing on Android, but it is not a Play Store production-signed build. The workflow does not deploy Supabase migrations, Edge Functions, or production settings.

A successful release workflow proves that the source passed the included checks and the APK was built; it does not prove live Supabase behavior or full device security.
