# Checkpoint 3A.2 isolated authority experiment

This is a tests-only, incomplete feasibility surface, not a production ledger.
Production CP2 source remains unchanged at c79b0d26044f0fd057496f62a6cfe443da5b98ff.
No installer, uninstaller, activation or registration code is invoked.

The private test namespace is HKLM64 Software/Everia-CP3A2-{random nonce}.
Its Authority and Canary children have explicit Administrators ownership and a
protected DACL: SYSTEM/Administrators full control, Authenticated Users read.
The Canary is outside Authority. Filesystem fixtures are below a unique runner
temporary root with a separate ExternalCanary sibling to the selected parent.
All relative payload operations call the unchanged CP2 NtCreateFile primitives.

The publisher only creates new Everia/Versions/anchor objects and observes their
volume/file identities through retained handles. The immutable fixture is one
non-executable text file. A bounded record binds schema/epoch/domain/nonce,
scope/SID/path, root/Versions/anchor IDs, build/inventory identity and anchor
object digest. SHA-256 is corruption detection, not authentication. The protected
registry security descriptor supplies the publication boundary under the assumed
trusted elevated-publisher threat model.

A separate publisher exits before a fresh synthetic restricted-token process
reads the protected record, pins and verifies filesystem evidence, then creates
only a new second generation. This token is not claimed to be an actual standard
account, SYSTEM context or a Windows UAC-linked filtered token.

The first bounded run measures this prerequisite, owner/DACL integrity,
denied rights, malformed/substituted/copied receipts and byte-preserved canaries.
It also runs the unchanged CP2 fixture safety suite. Regardless of green subset
results, the full gate remains UNPROVEN until actual required token contexts,
registry links/views and ancestors, forced publication interruptions, owning-user
Known Folder destination, complete read-only anchor lifetime and all registry
canary inventories are exercised. No production integration follows this run.

Prototype code is deliberately not a callable production authorizer. A random
namespace is only a disposable-test guard, not an application trust anchor.
Runtime administrator replacement of a receipt is used only to test refusal.
An administrator is trusted by the proposed model; its ability to recompute
checksum fields does not prove or disprove authentication by that checksum.
