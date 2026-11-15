# One-time CivilDesk 0.1.1 hosted installer rehearsal

This branch is **local preparation only**. No installer, hosted workflow, release, or user-data operation has run. The owner must separately review and authorize one exact-SHA branch-creation push.

## Source and trigger

- Parent and candidate installer source: `4cce3c6def9ceedbecae852dfd4b6860137910da` (`0.1.1`). Baseline installer source: `7d293bbc61dce674d796220e3241571a9f15aa6b` (`0.1.0`). The final workflow commit must be a direct child of the candidate and change only the five reviewed workflow, helper, test, and documentation files.
- The new `installer-rehearsal-once.yml` triggers on `push` to **only** `verification/installer-rehearsal-once-0.1.1`. The installer job additionally requires the branch-creation push payload (`created=true`), no force or deletion, exact `after` SHA, and run attempt 1. GitHub's hosted `windows-2022` runner and `contents:read` token are used. All third-party Actions are full-SHA pinned and checkout does not persist the token.
- The authorized source is the exact owner-reviewed workflow commit in a **new remote branch**, not a mutable name. The owner must verify live `main`, destination absence, local clean HEAD, and the complete diff immediately before an ordinary non-force push. There is no independent GitHub reviewer gate in this model.
- Later pushes to the branch still create workflow events; the unchanged job skips them because `created=false`. A rerun of the initial run has `run_attempt>1` and also skips. Anyone with write access able to change the branch workflow or recreate the branch could alter these checks, so operationally **freeze the branch after the one authorized push**. Do not rerun or update it without a separate security review and owner authorization. The job condition is a guard against accidents, not repository-level protection.
- Other automatic execution on the authorized push: ordinary `.github/workflows/ci.yml` runs its nonprivileged Windows frontend/native checks and NSIS **build only**. The existing release, Acceptance, E2E, and `tester-installer-rehearsal.yml` workflows are manual-only. No protected-installation rehearsal is present in this candidate.

## Credential-free source and execution boundary

The runner fetches both full SHAs from the currently public `webswe/CivilDesk` Git endpoint into fresh local repositories, then compares `FETCH_HEAD` and detached `HEAD` to each expected SHA. The helper disables inherited system/global Git configuration, credential helpers, extra HTTP headers, askpass, and terminal prompts for its process; it explicitly requires TLS verification and configures no source remote. If CivilDesk becomes private or exact-SHA fetching is unavailable, it **fails** without credential fallback. No GitHub App, PAT, secret, source artifact, installer artifact, or diagnostics upload is configured.

Only after workflow-parent and exact-source checks does the runner execute the **unchanged** `run.ps1` from the reviewed `4cce3c6…` candidate. Candidate build scripts and package dependencies run on a disposable hosted runner with no production credentials. The real `com.webswe.civildesk` identity is confined to that runner. Production D2L-CLI remains hard-disabled.

## Prepared acceptance path

The existing candidate harness builds both ordinary current-user NSIS installers, records their SHA-256 and Authenticode status, installs the baseline, verifies HKCU registration/version, creates synthetic preferences/tasks/projects/milestones/challenges/Calendar/portfolio records and a disposable external file, checks schema v10 and SQLite integrity/foreign keys, creates two independently validated online backups, upgrades in place, restarts and probes native records, uninstalls with data-retention checks, restores the baseline binary and a separate SQLite backup, and probes the recovered records and external file again. Database restoration and application rollback are separate operations. The path does not prove that an older app can use an un-restored newer database.

Running-app upgrades, interactive cancellation, interrupted installation, permission-denied updates, failed-upgrade recovery, WebView2 installation on a machine without it, Windows publisher signing, and a complete installer-bundle privacy audit remain **NOT VERIFIED**. They require separate controlled acceptance steps. An unsigned installer must be reported as unsigned. The workflow does not disable SmartScreen, TLS, or Windows security, and it does not install the protected per-machine overlay or access owner/tester data.
