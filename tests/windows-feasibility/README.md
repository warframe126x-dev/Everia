# Checkpoint 2: isolated native NTFS feasibility experiment

This is a test prototype, not a production maintenance helper or deletion authority.
No Everia installer, application, profile, registry or shortcut is used. The workflow
runs only on `qa/checkpoint2-ntfs-feasibility`; it does not trigger the existing
Stage 5 installer workflow, which is restricted to `v1.0` pushes.

## Execution and confinement

Windows x64/MSVC/CMake, fixed local NTFS, ASCII paths under 220 characters. Requires
`RUNNER_TEMP`. A new, exclusive disposable suite directory is created under that
runner directory. Mutation and recovery are separate subdirectories; the external
canary is their sibling. The executable exposes no arguments or command runner.
The test initializer alone creates the canary; mutation guards exclude it thereafter.
There is no recursive deletion or final directory sweep. Disposable fixtures remain
for runner disposal. No application binaries are produced or uploaded.

## Mechanisms under test

* `NtCreateFile`: single component relative to a held `RootDirectory` handle,
  `FILE_OPEN_REPARSE_POINT`, synchronous access, `FILE_SHARE_READ` only.
* Directory chain retained from drive root through operation completion. Every
  acquired component's attributes are checked through its handle; reparse objects
  are refused. Existing incompatible handles must cause refusal.
* File verification on the same retained handle: size, SHA-256 (BCrypt), volume
  serial/file ID, and exactly one hard link.
* `NtSetInformationFile(FileRenameInformation)`: destination directory handle and
  single leaf name, replacement disabled. Hash and file ID checked after rename.
* `FileDispositionInformation`: only an explicitly named empty directory; kernel
  must refuse nonempty directories. Never recursively enumerate removal targets.
* Small fixed test journal: version, phase, transaction ID, expected hash and SHA-256
  digest. Exclusive creation, `FlushFileBuffers`, read-back. Journal must match the
  independently reconstructed trusted test plan; it cannot supply operations/paths.

## Adversarial and recovery evidence

Static junction/file-symlink, additional hard link, locked file, malformed paths,
collision, modified/unknown files and nested unknown directory fixtures. A competing
thread makes at least 1,000 passes attempting target rename, ancestor rename, ancestor
junction conversion and hard-link creation while verified capability handles remain
open and the authorized rename executes. Any successful adversary operation fails.
Canary SHA-256 is verified after each test group. The current recovery experiment
closes all handles after rename before progress, and between rollback steps, then
reopens through a fixed trusted plan. It tests interruption/reopen ordering, not an
actual killed process or power failure. All recovery bytes are retained.

## Explicit limits

No claim of universality or production approval: same-volume moves only; ordinary
user-mode filesystem adversary, no kernel/admin bypass, malicious filesystem filter,
raw-disk writes, or inherited privileged handle attacker. Cross-volume recovery,
production ACLs/journal authentication, power-loss durability, production profile
overlap policy, Unicode/case-folding completeness, inventory integration and legacy
conversion remain outside this experiment. Tests cannot replace code review or prove
absence of every race. An unexpected native refusal/failure must be reported, not
worked around by broadening access or changing the invariant.

Passing this harness would establish only feasibility for the exercised mechanisms;
it is not authorization to implement production maintenance or NSIS integration.

## Bounded rename/sharing review

`rename-review.cpp` reuses the original prototype's primitives but never calls its
journal/recovery experiment. The workflow now executes only this review. It compares:

* baseline directory list/read-attributes/synchronize, share READ only;
* destination leaf traverse/read-attributes/synchronize, share READ only;
* destination leaf list/read-attributes/synchronize, share READ|WRITE (no DELETE).

All preceding destination ancestors remain baseline-locked; the verified source
file always retains read-data/delete/read-attributes/synchronize, share READ only.
Source-only access changes are negative isolation controls. The review tries both
classic native FileRenameInformation (10) and FileRenameInformationEx (65), with
replacement/POSIX/bypass flags disabled. No retained chain is closed before mutation.

Each adversarial candidate uses a freshly empty destination, so directory contents
cannot hide a junction-conversion weakness. Adversary write handles use compatible
READ|WRITE sharing instead of the earlier exclusive share mode. At least 1,000
passes attempt source-file/source-directory/destination-directory rename, new hard
links, and junction conversion through generic-write, write-data and attribute-write
access. Any successful namespace/reparse change rejects the candidate, even if the
canary bytes survive. A candidate passes only if its ordinary exact move AND its
adversarial exact move both succeed without those changes. Static junction/symlink,
hard-link, modified/unknown sentinel and outside-root checks remain mandatory.

The directory write-access probe is diagnostic only, never a mutation capability.
No candidate is production-approved merely by a successful isolated rename.
