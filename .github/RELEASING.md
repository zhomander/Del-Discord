# Releasing Del-Discord

For a new release, update the version in `package.json` and `package-lock.json`,
update any version labels in the installation guide, and run `npm run verify`
to regenerate and verify the committed userscript. Include these changes in a PR.

After the PR is merged into `main`, the Release workflow detects the version
change and verifies the exact merged commit on Linux, Windows, and macOS.
When all checks pass, it creates the matching `v<version>` tag and publishes
a GitHub release with generated release notes, both userscript builds, and `LICENSE`.
No manual tag or publish step is needed. Prerelease versions such as
`2.1.0-beta.1` are published as prereleases.

Merges without a version change do not create releases. Use a new version for
every release: existing releases are left unchanged, and a tag pointing to a
different commit causes the workflow to fail rather than overwrite it.

Manually pushed version tags still run verification and create a draft release
for manual review. Tags must match the package version.

If verification fails, check the Release workflow logs. Fix the problem in
another PR with a new version, or rerun a failed run when the failure was
temporary. The workflow needs GitHub Actions permission to write repository
contents; it does not require a personal access token.

The build produces `dist/Del-Discord-v1.user.js` for compact distribution and
`dist/Del-Discord.greasyfork.user.js` with readable JavaScript and CSS for
Greasy Fork uploads. Both files are verified and attached to releases.
