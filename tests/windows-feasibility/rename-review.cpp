// Bounded sharing experiment ONLY. Reuse the original fixture/safety primitives,
// but do NOT execute its journal/recovery experiment or previous entry point.
#define wmain previous_feasibility_entrypoint
#include "feasibility.cpp"
#undef wmain

struct Model { const char* name; ACCESS_MASK leafAccess; ULONG leafShare; };
const Model strict{"list-read-only", FILE_LIST_DIRECTORY, FILE_SHARE_READ};
const Model traverse{"traverse-attributes-read-only", FILE_TRAVERSE, FILE_SHARE_READ};
const Model writeShare{"list-read-write-share", FILE_LIST_DIRECTORY, FILE_SHARE_READ | FILE_SHARE_WRITE};

Handle variantChild(HANDLE parent, const std::wstring& name, ACCESS_MASK access, ULONG sharing) {
  component(name); UNICODE_STRING text{};
  text.Buffer = const_cast<PWSTR>(name.c_str());
  text.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t)); text.MaximumLength = text.Length;
  OBJECT_ATTRIBUTES attributes{}; attributes.Length = sizeof(attributes);
  attributes.RootDirectory = parent; attributes.ObjectName = &text; attributes.Attributes = 0x40;
  IO_STATUS_BLOCK status{}; HANDLE h = INVALID_HANDLE_VALUE;
  const auto result = createNt(&h, access | FILE_READ_ATTRIBUTES | SYNCHRONIZE, &attributes, &status,
    nullptr, FILE_ATTRIBUTE_NORMAL, sharing, openExisting, directoryOption | synchronousOption | noReparse, nullptr, 0);
  require(result >= 0, "variant directory opening failed"); Handle value(h); info(h); return value;
}
struct Destination {
  Chain ancestors; Handle directory;
  Destination(const std::wstring& path, const Model& model) : ancestors(fs::path(path).parent_path().wstring()),
    directory(variantChild(ancestors.leaf(), fs::path(path).filename().wstring(), model.leafAccess, model.leafShare)) {}
};
NTSTATUS moveWithClass(HANDLE file, HANDLE destination, const std::wstring& destinationPath,
                      const std::wstring& name, const Expected& e, ULONG informationClass) {
  mutationGuard(destinationPath + L"\\" + name); component(name); verify(file, e);
  const auto before = info(file), dir = info(destination);
  require(before.dwVolumeSerialNumber == dir.dwVolumeSerialNumber, "different volume");
  auto length = static_cast<ULONG>(name.size() * sizeof(wchar_t));
  Bytes buffer(sizeof(RenameInformation) + length, 0);
  auto* value = reinterpret_cast<RenameInformation*>(buffer.data());
  // Classic ReplaceIfExists=false, or Ex Flags=0. No POSIX/replace/bypass flags.
  value->replace = FALSE; value->root = destination; value->length = length;
  memcpy(value->name, name.data(), length); IO_STATUS_BLOCK io{};
  const auto result = setNt(file, &io, value, static_cast<ULONG>(buffer.size()), static_cast<FILE_INFORMATION_CLASS>(informationClass));
  if (result >= 0) { require(sameId(before, info(file)), "identity changed after rename"); verify(file, e); }
  return result;
}
void checkAllSentinels() {
  require(hash(snapshot(canary + L"\\outside.txt")) == canaryDigest, "OUTSIDE CANARY MODIFIED");
  for (const auto& sentinel : sentinels) require(hash(snapshot(sentinel.first)) == sentinel.second, "UNKNOWN SENTINEL MODIFIED");
  std::cout << "SENTINELS_OK count=" << sentinels.size() << " canary=" << hex(canaryDigest) << std::endl;
}
std::wstring suffix(unsigned index) { return std::to_wstring(index); }
bool isolation(unsigned index, const Model& sourceModel, const Model& destinationModel, ULONG informationClass) {
  auto source = caseRoot(L"isolate-" + suffix(index));
  auto target = recovery + L"\\isolate-" + suffix(index); makeDir(target);
  seed(source + L"\\owned", "owned original");
  Destination src(source, sourceModel), dst(target, destinationModel);
  auto file = child(src.directory.h, L"owned", false, FILE_READ_DATA | DELETE);
  verify(file.h, expected("owned original"));
  // Mimic the documented internal destination data-write open. No bytes written.
  Handle probe(CreateFileW(target.c_str(), FILE_ADD_FILE | SYNCHRONIZE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  const auto probeError = probe.h == INVALID_HANDLE_VALUE ? GetLastError() : 0;
  probe = Handle();
  const auto result = moveWithClass(file.h, dst.directory.h, target, L"moved", expected("owned original"), informationClass);
  std::cout << "ISOLATION source=" << sourceModel.name << " destination=" << destinationModel.name
    << " class=" << informationClass << " directory-write-open-win32=" << probeError
    << " rename-ntstatus=0x" << std::hex << static_cast<unsigned long>(result) << std::dec << std::endl;
  require(hash(read(file.h)) == expected("owned original").sha, "verified source changed");
  checkAllSentinels(); return result >= 0;
}
// Unlike the earlier adversary's share=0, this writer shares existing directory
// reads. This removes an accidental sharing incompatibility from the attack.
bool compatibleJunction(const std::wstring& path, DWORD access) {
  mutationGuard(path);
  Handle h(CreateFileW(path.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (h.h == INVALID_HANDLE_VALUE) return false;
  auto substitute = L"\\??\\" + canary;
  struct Mount { DWORD tag; WORD size; WORD reserved; WORD subOffset; WORD subLength; WORD printOffset; WORD printLength; WCHAR data[1]; };
  const auto subBytes = substitute.size() * 2, printBytes = canary.size() * 2;
  Bytes buffer(offsetof(Mount, data) + subBytes + 2 + printBytes + 2, 0);
  auto* value = reinterpret_cast<Mount*>(buffer.data()); value->tag = IO_REPARSE_TAG_MOUNT_POINT;
  value->size = static_cast<WORD>(buffer.size() - 8); value->subLength = static_cast<WORD>(subBytes);
  value->printOffset = static_cast<WORD>(subBytes + 2); value->printLength = static_cast<WORD>(printBytes);
  memcpy(value->data, substitute.data(), subBytes);
  memcpy(reinterpret_cast<unsigned char*>(value->data) + value->printOffset, canary.data(), printBytes);
  DWORD count = 0;
  return DeviceIoControl(h.h, FSCTL_SET_REPARSE_POINT, buffer.data(), static_cast<DWORD>(buffer.size()), nullptr, 0, &count, nullptr) != 0;
}
bool adversarial(unsigned index, const Model& model, ULONG informationClass) {
  auto source = caseRoot(L"race-review-" + suffix(index));
  auto target = recovery + L"\\race-review-" + suffix(index); makeDir(target); // intentionally EMPTY
  auto targetMoved = recovery + L"\\race-moved-" + suffix(index);
  auto sourceMoved = source + L"\\owned-swapped";
  auto sourceRootMoved = mutation + L"\\source-moved-" + suffix(index);
  for (const auto& p : {target, targetMoved, source, sourceRootMoved, source + L"\\owned", sourceMoved, source + L"\\alias"}) mutationGuard(p);
  seed(source + L"\\owned", "owned original");
  Chain src(source); Destination dst(target, model);
  auto file = child(src.leaf(), L"owned", false, FILE_READ_DATA | DELETE);
  verify(file.h, expected("owned original")); const auto id = info(file.h);
  std::atomic<bool> stop{false}; std::atomic<unsigned> attempts{0}, targetRenames{0}, sourceRenames{0}, fileRenames{0}, hardLinks{0}, junctions{0};
  std::thread attacker([&] {
    while (!stop || attempts < 1000) {
      if (MoveFileExW(target.c_str(), targetMoved.c_str(), 0)) ++targetRenames;
      if (MoveFileExW(source.c_str(), sourceRootMoved.c_str(), 0)) ++sourceRenames;
      if (MoveFileExW((source + L"\\owned").c_str(), sourceMoved.c_str(), 0)) ++fileRenames;
      if (CreateHardLinkW((source + L"\\alias").c_str(), (source + L"\\owned").c_str(), nullptr)) ++hardLinks;
      for (const auto access : std::array<DWORD, 3>{GENERIC_WRITE, FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA})
        if (compatibleJunction(target, access)) ++junctions;
      ++attempts;
    }
  });
  while (attempts < 1000) std::this_thread::yield();
  NTSTATUS result = static_cast<NTSTATUS>(0xc0000001UL); std::string refusal;
  try { result = moveWithClass(file.h, dst.directory.h, target, L"moved", expected("owned original"), informationClass); }
  catch (const Refusal& failure) { refusal = failure.what(); }
  stop = true; attacker.join();
  require(sameId(id, info(file.h)) && hash(read(file.h)) == expected("owned original").sha, "source object changed");
  checkAllSentinels();
  const bool safe = result >= 0 && refusal.empty() && targetRenames == 0 && sourceRenames == 0 && fileRenames == 0 && hardLinks == 0 && junctions == 0;
  std::cout << "CANDIDATE model=" << model.name << " class=" << informationClass << " passes=" << attempts
    << " target-directory-renames=" << targetRenames << " source-directory-renames=" << sourceRenames << " file-renames=" << fileRenames
    << " hardlinks=" << hardLinks << " junction-conversions=" << junctions
    << " rename-ntstatus=0x" << std::hex << static_cast<unsigned long>(result) << std::dec
    << " refusal=" << refusal << " SAFE=" << safe << std::endl;
  return safe;
}
void staticChecks() {
  auto root = caseRoot(L"review-static"); makeDir(root + L"\\junction"); junction(root + L"\\junction", canary);
  refuse([&] { Chain redirected(root + L"\\junction"); });
  mutationGuard(root + L"\\symlink");
  require(CreateSymbolicLinkW((root + L"\\symlink").c_str(), (canary + L"\\outside.txt").c_str(),
    SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE) != 0, "symlink fixture unavailable");
  Chain chain(root);
  refuse([&] { auto link = child(chain.leaf(), L"symlink", false, FILE_READ_DATA | DELETE); });
  mutationGuard(root + L"\\hardlink");
  require(CreateHardLinkW((root + L"\\hardlink").c_str(), (canary + L"\\outside.txt").c_str(), nullptr) != 0, "hardlink fixture failed");
  auto linked = child(chain.leaf(), L"hardlink", false, FILE_READ_DATA | DELETE);
  require(info(linked.h).nNumberOfLinks == 2, "wrong hardlink count");
  refuse([&] { verify(linked.h, expected("external disposable canary")); });
  seed(root + L"\\modified", "user changed bytes");
  auto modified = child(chain.leaf(), L"modified", false, FILE_READ_DATA | DELETE);
  refuse([&] { verify(modified.h, expected("owned original")); });
  require(hash(read(modified.h)) == expected("user changed bytes").sha, "modified bytes changed");
  refuse([&] { mutationGuard(canary + L"\\outside.txt"); });
  checkAllSentinels(); std::cout << "STATIC reparse/hardlink/modified/unknown/outside-root PASS" << std::endl;
}
int wmain() {
  try {
    auto module = GetModuleHandleW(L"ntdll.dll");
    createNt = reinterpret_cast<CreateFn>(GetProcAddress(module, "NtCreateFile"));
    setNt = reinterpret_cast<SetFn>(GetProcAddress(module, "NtSetInformationFile")); require(createNt && setNt, "native APIs unavailable");
    wchar_t temp[256]{}; require(GetEnvironmentVariableW(L"RUNNER_TEMP", temp, 256) > 0, "CI RUNNER_TEMP required");
    std::wstring base(temp); while (!base.empty() && base.back() == L'\\') base.pop_back(); absolute(base);
    suite = base + L"\\cp2-review-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64());
    {
      Chain parent(base); auto dir = child(parent.leaf(), fs::path(suite).filename().wstring(), true, FILE_LIST_DIRECTORY, createNew);
      auto m = child(dir.h, L"mutation", true, FILE_LIST_DIRECTORY, createNew);
      auto r = child(dir.h, L"recovery", true, FILE_LIST_DIRECTORY, createNew);
      auto c = child(dir.h, L"canary", true, FILE_LIST_DIRECTORY, createNew);
      auto sentinel = child(c.h, L"outside.txt", false, FILE_READ_DATA | FILE_WRITE_DATA, createNew);
      writeNew(sentinel.h, bytes("external disposable canary"));
    }
    mutation = suite + L"\\mutation"; recovery = suite + L"\\recovery"; canary = suite + L"\\canary";
    canaryDigest = hash(snapshot(canary + L"\\outside.txt"));
    std::wcout << L"DISPOSABLE_ROOT=" << suite << L"\nNTFS_FIXED_LOCAL\n";
    std::cout << "CANARY_BEFORE=" << hex(canaryDigest) << std::endl; staticChecks();
    unsigned index = 0, safe = 0;
    require(!isolation(++index, strict, strict, 10), "baseline unexpectedly succeeded");
    require(!isolation(++index, traverse, strict, 10), "source-only change unexpectedly resolved conflict");
    for (const auto& model : {traverse, writeShare}) {
      for (const auto informationClass : {10UL, 65UL}) {
        const bool moved = isolation(++index, strict, model, informationClass);
        const bool protectedMove = adversarial(++index, model, informationClass);
        if (moved && protectedMove) ++safe;
      }
    }
    checkAllSentinels(); std::cout << "CANARY_AFTER=" << hex(hash(snapshot(canary + L"\\outside.txt")))
      << "\nSAFE_CANDIDATE_CLASS_COMBINATIONS=" << safe << std::endl;
    return safe > 0 ? 0 : 1;
  } catch (const std::exception& failure) {
    std::cerr << "FAIL " << failure.what() << " win32=" << GetLastError() << std::endl; return 1;
  }
}
