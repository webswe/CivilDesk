# Disposable Scope A installation rehearsal

This repository contains a **locally reviewable** rehearsal. No protected installer has been installed by this change. `APPROVED_FROZEN` remains `None`.

## Execution boundary

The dedicated workflow `.github/workflows/protected-installation-rehearsal.yml` runs only for a push to `verification/scope-a-installation-rehearsal` in `webswe/CivilDesk`. It has `contents: read`, checkout without persisted credentials, and no artifact upload, release, secrets, or deployment step. The protected installer is built from that checked-out SHA in the same job as its installation test. The runner script requires the expected repository, exact ref and SHA, Windows, GitHub-hosted runner environment, administrator token, and a build target under the checkout before changing anything. It records SHA-256 and generated NSIS metadata before launching the installer. Any unexpected installation result stops the remaining gates and writes local JSON plus a status-only job summary.

GitHub only offers manual `workflow_dispatch` for workflows present on the default branch. This workflow deliberately has **no** manual dispatch trigger. The owner may separately authorize one reviewed push that creates the dedicated verification branch. Do not use `workflow_dispatch`, `workflow_run`, `pull_request_target`, or the build-only branch as a substitute.

## Evidence and limits

The JSON report remains under `RUNNER_TEMP` and is not uploaded. It records source SHA, runner image/version, Windows version, Tauri CLI version, pre-install installer hash, Authenticode status, NSIS mode, installation paths, and structured gate statuses. The unsigned installer is only identified by the same-job source and digest; it has no publisher identity. GitHub-hosted Windows runners disable UAC, so no UAC prompt is verified.

The harness prepares a synthetic HKCU registration, executable, and shortcut before the protected machine install. It checks coexistence with HKLM and all-users shortcuts, then checks that machine uninstall preserves the synthetic user installation. This demonstrates conflict detection and uninstall boundaries, not a safe real current-user upgrade.

The synthetic separate package uses a copy of the runner's PowerShell executable under a rehearsal-only Program Files directory. It is never the actual `3ce1648` package. A synthetic independent manifest exercises the shipped inventory verifier and negative cases for changed and missing files, wrong canonical root, and wrong manifest digest. A distinct standard Windows account probes read access and denied write, move, delete, create, parent modification, ACL change, and ownership change, then launches the installed application. The separate account creates a synthetic marker in its own CivilDesk app data; machine uninstall must preserve it. The separate package also survives uninstall.

The runner creates and removes an outbound firewall rule for the exact synthetic executable path and verifies all three profiles, alternate-path mismatch, and rule removal. The runner accepts an optional `-ControlledEndpointIp` and `-ControlledEndpointPort` pair for a separately approved, non-Brightspace TCP endpoint; it checks reachability before, during, and after the rule. **Outbound enforcement remains NOT VERIFIED in the checked-in workflow:** no endpoint is supplied. Loopback blocking would not prove ordinary outbound policy. No Brightspace destination or credential is used. The path rule does not cover copied binaries or child executables.

The Python fixture runs shipped migration SQL on generated v8 SQLite data, makes and hashes a backup, verifies v10 records, integrity and foreign keys, forces a failed v9 migration to check rollback, and restores the matched v8 backup. An older application binary is never opened against v10. An actual application-version rollback remains NOT VERIFIED because this workflow has only one protected build. A real current-user installer transition also remains NOT VERIFIED.

## Conditions before the privileged push

Review the local commit and workflow diff, verify the remote starting refs, confirm the destination is a disposable GitHub-hosted Windows runner, and separately authorize creation/push of `verification/scope-a-installation-rehearsal`. Before any production decision, provide a controlled non-Brightspace network endpoint and a matched prior application build for the remaining enforcement and rollback gates. The installer is never uploaded or released by this workflow.
