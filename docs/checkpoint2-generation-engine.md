# Checkpoint 2: create-only generation engine

This checkpoint supplies a native Windows x64 static library, not an installer or
privileged filesystem service. It cannot activate, register, move, overwrite,
uninstall, or delete an installation. NSIS and the existing application are unchanged.

## Authority and layout

`Root::create(selected, exclusions)` validates a pre-existing selected directory,
pins every ancestor, and exclusively creates `Everia/Versions`. Existing objects
at either container component cause refusal. The returned in-memory root capability
can create multiple generations during that invocation. A future invocation cannot
adopt those containers for mutation. Persistent reuse/activation needs a separately
reviewed checkpoint; read-only inspection grants no mutation authority.

The final layout is `selected/Everia/Versions/<source-prefix-12>-<random-128-bit>/`.
A collision is an error, never a retry by adoption. Payload and state are created
directly at that destination. There is no staging-directory promotion.

Only local fixed NTFS on native Windows x64 is supported. Paths/components are
conservatively ASCII, absolute DOS paths; Unicode paths, network/removable drives,
devices, traversal, ADS, reserved names, ambiguous suffixes, case-sensitive
folders, short-name aliases, and reparse ancestors are refused. Selected ancestors
named exactly Everia, Versions, AppData or .everia-state are refused, as are overlaps
with the known roaming Everia profile, local EveriaMaintenance storage and caller
exclusions. Substring matches never establish ownership. Caller exclusions can
only reduce authority. The selected directory must already exist; the library
creates only its new Everia/container/generation descendants.

Every directory component is opened/created relative to a retained parent handle
with `NtCreateFile`, one validated component, `OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE`,
`FILE_OPEN_REPARSE_POINT`, synchronous I/O and `FILE_SHARE_READ` only. New objects use
`FILE_CREATE` and require the kernel's FILE_CREATED result. Directory capabilities
request LIST_DIRECTORY, READ_ATTRIBUTES and SYNCHRONIZE; newly writable files request
READ_DATA, WRITE_DATA, READ_ATTRIBUTES and SYNCHRONIZE. No write/delete sharing,
backup/restore privileges, fallback extraction or general command execution exists.

Returned file handles remain authoritative for writes, FlushFileBuffers, read-back,
SHA-256, file-ID/link/reparse checks and canonical confinement verification. Every
payload/metadata/directory handle remains retained through final verification.
Directory enumeration is handle-based. Unexpected entries and alternate data streams
are rejected. Source payload files are also pinned, single-linked, stream-checked
and hashed against the compiled inventory before copying.

## Trusted build inventory

`tools/generation/inventory.py` generates a compiled, const inventory from the
actual packaged payload. Schema 1 covers source/build/archive provenance, x64 target,
sorted directories and file paths, sizes, SHA-256 and fixed role codes. The digest
hashes an explicit ASCII canonical representation (not incidental JSON formatting).
Windows case-equivalent collisions and malformed parents/paths are rejected at
build time and the library revalidates the compiled inventory before use. Limits:
10,000 files, 4,096 directories, 2 GiB/file, 8 GiB total, relative path 240 characters.
Configure must be rerun when payload bytes change; stale inventory fails read-back.

The safety workflow recovers the authenticated portable artifact 11092205934 from
run 36705033196/source 5426ad4..., verifies its immutable artifact digest and its
original per-file launch-tested manifest, then builds the production library against
those exact payload bytes. It never downloads or executes the unsafe installer,
launches Everia, packages an application, or uploads helper/application binaries.
A small synthetic inventory compiles the identical production code for adversarial
tests. Test hooks exist only under EVERIA_GENERATION_TESTING.

## Creation state, not deletion authority

`.everia-state/00-creating.state` and `01-ready.state` are exclusively created,
append-only bounded records (4 KiB maximum each). Schema 1 binds phase, active=false,
generation ID, source, build, inventory digest, canonical root, volume/file ID and
SHA-256. Each record is flushed and read back before continuing. No arbitrary paths,
commands or mutation instructions are interpreted from a record. Installed records
are not authentication or cleanup authority; SHA-256 detects corruption, not an
attacker capable of rewriting the record. Only the embedded inventory and retained
capabilities grant creation authority.

Population hashes source and target, verifies complete directory membership,
identities, links, streams and metadata, then writes and re-verifies the ready record.
Ready means verified, never active. Inspection independently repeats complete payload
verification before returning ready_verified; the presence of a ready filename or
its text alone never suffices. An interruption may leave empty container components,
an empty unique generation, or a bounded partial tree. No destructive rollback,
cleanup, or automatic resume occurs. Missing ready state is incomplete; malformed,
transplanted, oversized or inconsistent state is invalid. Such state grants nothing.
A ready record written just before an interruption still requires complete read-only
verification on the next invocation. Power-loss durability is limited to Windows/NTFS
flush guarantees; no claim is made about hardware that ignores flushes.

## Validation boundary

Dedicated disposable Windows tests cover actual-payload round-trip, exclusive
collisions, strict paths, forced empty retained-root junction conversion, static
junction parsing, blocked ancestor replacement, sustained conversion/rename races,
concurrent target replacement/write/hard-link attempts, partial and abrupt-process
interruption, tampered/transplanted/oversized state, hash mismatch, unexpected entries,
and streams. External canary and old-installation fixture inventories include exact
paths, sizes and SHA-256 and are compared after every scenario/race round. No canary
or prior-generation mutation is authorized. Tests keep partial/reparse fixtures for
runner disposal; neither the engine nor test harness performs recursive cleanup.

This does not prove safety against a kernel administrator, raw-volume writes or an
untrusted binary executing inside this process. Activation, existing-container reuse,
legacy conversion, registration, shortcuts and safe cleanup remain unauthorised and
unimplemented. Windows Server 2022/NTFS evidence is not automatic proof for every
Windows/filesystem/security environment.
