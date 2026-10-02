// TESTS ONLY: create-only confinement. No installer, registry, cleanup, rename,
// credential/profile access, or production entry point. Existing prototypes are
// compiled for reusable bounded helpers, but their entry points are not called.
#define wmain unused_original_entrypoint
#include "feasibility.cpp"
#undef wmain
#include <map>
#include <iomanip>

constexpr ULONG dontReparse = 0x1000, insensitive = 0x40;
struct CreationModel { const char* label; ULONG attributes; ULONG extra; };
const CreationModel leafOnly{"leaf-no-follow", insensitive, noReparse};
const CreationModel guarded{"dont-reparse-and-leaf-no-follow", insensitive | dontReparse, noReparse};
const CreationModel parseOnly{"dont-reparse-only", insensitive | dontReparse, 0};
unsigned sequence = 0, passedCases = 0;
std::wstring evidence;

BY_HANDLE_FILE_INFORMATION rawInfo(HANDLE h) {
  BY_HANDLE_FILE_INFORMATION value{};
  require(GetFileInformationByHandle(h, &value) != 0, "raw identity query failed"); return value;
}
std::wstring finalPath(HANDLE h) {
  wchar_t buffer[1024]{};
  auto size = GetFinalPathNameByHandleW(h, buffer, 1024, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  require(size > 0 && size < 1024, "canonical path query failed");
  std::wstring p(buffer); if (p.starts_with(L"\\\\?\\")) p.erase(0, 4); return p;
}
std::string ascii(const std::wstring& text) {
  std::string result; for (wchar_t c : text) { require(c < 128, "non-ASCII evidence path"); result += static_cast<char>(c); } return result;
}
void describe(const char* role, HANDLE h, ACCESS_MASK access, ULONG share, ULONG disposition, ULONG options, ULONG attrs) {
  const auto i = rawInfo(h);
  std::cout << "IDENTITY role=" << role << " path=" << ascii(finalPath(h)) << " volume=" << i.dwVolumeSerialNumber
    << " file-id=" << i.nFileIndexHigh << ':' << i.nFileIndexLow << " reparse=" << !!(i.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
    << " links=" << i.nNumberOfLinks << " access=0x" << std::hex << access << " share=0x" << share
    << " disposition=" << disposition << " options=0x" << options << " object-attributes=0x" << attrs << std::dec << std::endl;
}
using Inventory = std::map<std::wstring, std::string>;
Inventory inventory(const std::wstring& root) {
  require(root == canary || beneath(root, mutation), "inventory outside disposable domain");
  Inventory result;
  for (const auto& entry : fs::recursive_directory_iterator(root)) {
    const auto p = entry.path().wstring();
    const auto attributes = GetFileAttributesW(p.c_str());
    require(attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT), "inventory contains reparse object");
    const auto relative = p.substr(root.size() + 1);
    if (attributes & FILE_ATTRIBUTE_DIRECTORY) result.emplace(relative, "directory");
    else {
      Handle h(CreateFileW(p.c_str(), FILE_READ_DATA | FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
      require(h.h != INVALID_HANDLE_VALUE, "inventory file open failed");
      auto content = read(h.h); result.emplace(relative, "file size=" + std::to_string(content.size()) + " sha256=" + hex(hash(content)));
    }
  }
  return result;
}
void saveInventory(const Inventory& value, const std::string& name) {
  std::ofstream out(fs::path(evidence) / name, std::ios::binary); require(out.good(), "evidence write failed");
  for (const auto& [p, detail] : value) out << ascii(p) << '\t' << detail << '\n';
  out.flush(); require(out.good(), "evidence flush failed");
}
void compareCanary(const Inventory& before, const std::string& name) {
  const auto after = inventory(canary); saveInventory(after, name + "-after.txt");
  require(before == after, "GATE FAILURE: external canary inventory/bytes changed");
  std::cout << "CANARY_COMPLETE_UNCHANGED scenario=" << name << " entries=" << after.size() << std::endl;
}
// There is deliberately no parent reparse precheck here. This tests the actual
// native parse, not whether a user-space check happened to win a race.
NTSTATUS relativeCreate(HANDLE parent, const std::wstring& name, bool directory, const CreationModel& model,
                        Handle& result, const std::wstring& intended, bool log = true) {
  component(name); mutationGuard(intended);
  UNICODE_STRING text{}; text.Buffer = const_cast<PWSTR>(name.c_str());
  text.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t)); text.MaximumLength = text.Length;
  OBJECT_ATTRIBUTES oa{}; oa.Length = sizeof(oa); oa.RootDirectory = parent; oa.ObjectName = &text; oa.Attributes = model.attributes;
  IO_STATUS_BLOCK io{}; HANDLE value = INVALID_HANDLE_VALUE;
  const auto access = (directory ? FILE_LIST_DIRECTORY : FILE_READ_DATA | FILE_WRITE_DATA) | FILE_READ_ATTRIBUTES | SYNCHRONIZE;
  const auto options = synchronousOption | model.extra | (directory ? directoryOption : fileOption);
  const auto status = createNt(&value, access, &oa, &io, nullptr, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, createNew, options, nullptr, 0);
  if (status >= 0) {
    result = Handle(value);
    if (log) describe(directory ? "created-directory" : "created-file", value, access, FILE_SHARE_READ, createNew, options, model.attributes);
    require(io.Information == 2, "create did not report FILE_CREATED");
    const auto i = rawInfo(value); const auto path = finalPath(value);
    require(beneath(path, mutation), "GATE FAILURE: returned object escaped authorized root");
    require(upper(path) == upper(intended), "returned object differs from intended path");
    require(!(i.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT), "created object is reparse");
    require(directory || i.nNumberOfLinks == 1, "new file acquired a hard link");
  }
  return status;
}
Handle mustCreate(HANDLE parent, const std::wstring& name, bool directory, const std::wstring& path) {
  Handle h; require(relativeCreate(parent, name, directory, guarded, h, path) >= 0, "authorized native creation failed"); return h;
}
std::wstring fresh(const std::wstring& title) {
  auto p = mutation + L"\\" + title + L"-" + std::to_wstring(++sequence); makeDir(p); return p;
}
bool setMount(HANDLE h) {
  const auto substitute = L"\\??\\" + canary;
  struct Mount { DWORD tag; WORD size; WORD reserved; WORD subOffset; WORD subLength; WORD printOffset; WORD printLength; WCHAR data[1]; };
  const auto sub = substitute.size() * sizeof(wchar_t), print = canary.size() * sizeof(wchar_t);
  Bytes buffer(offsetof(Mount, data) + sub + 2 + print + 2, 0); auto* m = reinterpret_cast<Mount*>(buffer.data());
  m->tag = IO_REPARSE_TAG_MOUNT_POINT; m->size = static_cast<WORD>(buffer.size() - 8); m->subLength = static_cast<WORD>(sub);
  m->printOffset = static_cast<WORD>(sub + 2); m->printLength = static_cast<WORD>(print);
  memcpy(m->data, substitute.data(), sub); memcpy(reinterpret_cast<unsigned char*>(m->data) + m->printOffset, canary.data(), print);
  DWORD count = 0; return DeviceIoControl(h, FSCTL_SET_REPARSE_POINT, buffer.data(), static_cast<DWORD>(buffer.size()), nullptr, 0, &count, nullptr) != 0;
}
bool clearMount(HANDLE h) {
  struct { DWORD tag; WORD length; WORD reserved; } data{IO_REPARSE_TAG_MOUNT_POINT, 0, 0}; DWORD count = 0;
  return DeviceIoControl(h, FSCTL_DELETE_REPARSE_POINT, &data, sizeof(data), nullptr, 0, &count, nullptr) != 0;
}
Handle adversaryHandle(const std::wstring& path, DWORD access) {
  mutationGuard(path);
  return Handle(CreateFileW(path.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
}
void deterministicRoot(const CreationModel& model, unsigned level, bool directoryChild) {
  const auto name = "deterministic-" + std::string(model.label) + "-level-" + std::to_string(level) + (directoryChild ? "-directory" : "-file");
  const auto before = inventory(canary); saveInventory(before, name + "-before.txt");
  auto path = fresh(L"deterministic");
  std::vector<Handle> nested; Chain chain(path);
  for (unsigned n = 0; n < level; ++n) {
    const std::wstring part = n == 0 ? L"Everia" : n == 1 ? L"Versions" : L"build-unique";
    path += L"\\" + part; nested.push_back(mustCreate(nested.empty() ? chain.leaf() : nested.back().h, part, true, path));
  }
  const auto parent = nested.empty() ? chain.leaf() : nested.back().h;
  const auto id = rawInfo(parent); require(!(id.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT), "fixture initially reparse");
  describe("retained-empty-root-before", parent, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_SHARE_READ, level ? createNew : openExisting,
    synchronousOption | directoryOption | noReparse, level ? guarded.attributes : insensitive);
  // Root is EMPTY. Conversion completes synchronously before the next NtCreateFile.
  Handle attacker = adversaryHandle(path, FILE_WRITE_ATTRIBUTES);
  require(attacker.h != INVALID_HANDLE_VALUE && setMount(attacker.h), "UNPROVEN: forced root conversion unavailable");
  require(sameId(id, rawInfo(parent)) && (rawInfo(parent).dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT), "conversion not observed on retained object");
  describe("retained-root-after-conversion", parent, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_SHARE_READ, openExisting,
    synchronousOption | directoryOption | noReparse, model.attributes);
  Handle made; NTSTATUS status = 0; std::string problem;
  try {
    status = relativeCreate(parent, L"payload", directoryChild, model, made, path + L"\\payload");
    if (status >= 0 && !directoryChild) { const auto fileId = rawInfo(made.h); writeNew(made.h, bytes("authorized fresh payload")); require(sameId(fileId, rawInfo(made.h)), "write identity changed"); }
  } catch (const std::exception& e) { problem = e.what(); }
  compareCanary(before, name); require(problem.empty(), problem.c_str());
  require(sameId(id, rawInfo(parent)), "retained directory identity changed");
  std::cout << "DETERMINISTIC model=" << model.label << " level=" << level << " directory-child=" << directoryChild
    << " conversion=confirmed ntstatus=0x" << std::hex << static_cast<unsigned long>(status) << std::dec
    << " result=" << (status < 0 ? "refused" : "confined") << std::endl;
  ++passedCases;
}
void normalAndCollisions() {
  const auto before = inventory(canary); saveInventory(before, "normal-collisions-before.txt");
  auto p = fresh(L"selected-Everia-word-in-parent"); Chain c(p); describe("selected-root", c.leaf(), FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_SHARE_READ, openExisting, synchronousOption | directoryOption | noReparse, insensitive);
  std::vector<Handle> held;
  for (const auto* part : {L"Everia", L"Versions", L"build-unique", L"resources"}) {
    auto parent = held.empty() ? c.leaf() : held.back().h; p += L"\\" + std::wstring(part); held.push_back(mustCreate(parent, part, true, p));
  }
  auto file = mustCreate(held.back().h, L"payload.bin", false, p + L"\\payload.bin");
  const auto id = rawInfo(file.h); const auto data = bytes("create-only verified payload"); writeNew(file.h, data);
  require(sameId(id, rawInfo(file.h)), "normal file identity changed");
  Handle collision;
  require(relativeCreate(held.back().h, L"PAYLOAD.BIN", false, guarded, collision, p + L"\\PAYLOAD.BIN") < 0, "case-equivalent collision accepted");
  require(read(file.h) == data, "ordinary collision overwrote file");
  require(relativeCreate(c.leaf(), L"everia", true, guarded, collision, finalPath(c.leaf()) + L"\\everia") < 0, "existing generation directory accepted");
  compareCanary(before, "normal-collisions"); ++passedCases;
  // Fixtures MUST precede strict directory handles, as required by prior evidence.
  auto links = fresh(L"collision-fixtures");
  const auto symlink = links + L"\\symlink", hardlink = links + L"\\hardlink";
  mutationGuard(symlink); mutationGuard(hardlink);
  require(CreateSymbolicLinkW(symlink.c_str(), (canary + L"\\outside.txt").c_str(), SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE) != 0, "symlink fixture unavailable");
  require(CreateHardLinkW(hardlink.c_str(), (canary + L"\\outside.txt").c_str(), nullptr) != 0, "hardlink fixture unavailable");
  const auto linkBefore = inventory(canary); saveInventory(linkBefore, "link-collisions-before.txt"); Chain linkParent(links);
  for (const auto& model : {leafOnly, guarded, parseOnly}) for (const auto* leaf : {L"symlink", L"hardlink"}) {
    Handle output; const auto s = relativeCreate(linkParent.leaf(), leaf, false, model, output, links + L"\\" + leaf);
    require(s < 0, "existing link collision accepted");
    std::cout << "COLLISION model=" << model.label << " leaf=" << ascii(leaf) << " ntstatus=0x" << std::hex << static_cast<unsigned long>(s) << std::dec << std::endl;
  }
  compareCanary(linkBefore, "link-collisions"); ++passedCases;
}
void intermediateParse() {
  auto root = fresh(L"parse-diagnostic"); makeDir(root + L"\\junction"); junction(root + L"\\junction", canary);
  Chain chain(root); const auto before = inventory(canary); saveInventory(before, "intermediate-parse-before.txt");
  // Read-only diagnostic: production candidate accepts single components only.
  // This intentionally bypasses component() ONLY to see which name-parsing stage
  // OBJ_DONT_REPARSE protects. No creation or mutation at redirected destination.
  for (const auto& model : {leafOnly, guarded, parseOnly}) {
    std::wstring name = L"junction\\outside.txt"; UNICODE_STRING text{};
    text.Buffer = name.data(); text.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t)); text.MaximumLength = text.Length;
    OBJECT_ATTRIBUTES oa{}; oa.Length = sizeof(oa); oa.RootDirectory = chain.leaf(); oa.ObjectName = &text; oa.Attributes = model.attributes;
    IO_STATUS_BLOCK io{}; HANDLE out = INVALID_HANDLE_VALUE;
    const auto status = createNt(&out, FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, &oa, &io, nullptr, FILE_ATTRIBUTE_NORMAL,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, openExisting, synchronousOption | fileOption | model.extra, nullptr, 0);
    Handle h(out); std::cout << "INTERMEDIATE_PARSE model=" << model.label << " ntstatus=0x" << std::hex << static_cast<unsigned long>(status) << std::dec;
    if (status >= 0) std::cout << " actual=" << ascii(finalPath(h.h)); std::cout << std::endl;
    if (model.attributes & dontReparse) require(status < 0, "OBJ_DONT_REPARSE did not reject intermediate junction");
  }
  compareCanary(before, "intermediate-parse"); ++passedCases;
}
void invalidInputs() {
  for (const auto& s : {L"..", L"a\\b", L"a/b", L"file:stream", L"CON", L"NUL.txt", L"COM1", L"a.", L"a ", L"\\\\server\\share", L"\\\\?\\C:\\path", L"C:\\", L""})
    refuse([&] { component(s); });
  for (const auto& s : {L"C:\\", L"\\\\server\\share\\file", L"\\\\.\\PhysicalDrive0", L"C:\\a\\..\\b", L"C:\\a:stream", L"relative", L"C:\\CON\\file"})
    refuse([&] { absolute(s); });
  refuse([&] { mutationGuard(canary + L"\\forbidden"); });
  std::cout << "INPUTS traversal/ADS/device/UNC/roots/ambiguous PASS; path-domain=bounded-ASCII-local-NTFS" << std::endl; ++passedCases;
}
void sustained(unsigned level) {
  const auto name = "race-level-" + std::to_string(level);
  const auto before = inventory(canary); saveInventory(before, name + "-before.txt");
  unsigned totalAttempts = 0, conversions = 0, clears = 0, parentMoves = 0, successfulCreates = 0, refusals = 0;
  for (unsigned round = 0; round < 64; ++round) {
    auto p = fresh(L"race"); Chain chain(p); std::vector<Handle> nested;
    for (unsigned n = 0; n < level; ++n) {
      const std::wstring part = n == 0 ? L"Everia" : n == 1 ? L"Versions" : L"build-unique";
      auto parent = nested.empty() ? chain.leaf() : nested.back().h; p += L"\\" + part; nested.push_back(mustCreate(parent, part, true, p));
    }
    const auto parent = nested.empty() ? chain.leaf() : nested.back().h; const auto parentId = rawInfo(parent);
    // No children/locking sentinels inside attacked root at this point.
    Handle attacker = adversaryHandle(p, FILE_WRITE_ATTRIBUTES); require(attacker.h != INVALID_HANDLE_VALUE, "race attacker cannot open");
    const auto moved = p + L"-moved"; mutationGuard(moved);
    std::atomic<bool> stop{false}; std::atomic<unsigned> attempts{0}, sets{0}, removed{0}, moves{0};
    std::thread thread([&] {
      while (!stop || attempts < 16) {
        if (setMount(attacker.h)) ++sets;
        if (MoveFileExW(p.c_str(), moved.c_str(), 0)) ++moves;
        if (clearMount(attacker.h)) ++removed;
        ++attempts;
      }
    });
    while (attempts < 8) std::this_thread::yield();
    Handle file; NTSTATUS status = 0; std::string failure;
    try {
      status = relativeCreate(parent, L"payload", false, guarded, file, p + L"\\payload");
      if (status >= 0) {
        const auto id = rawInfo(file.h); writeNew(file.h, bytes("fresh race payload")); require(sameId(id, rawInfo(file.h)), "raced file identity changed");
      }
    } catch (const std::exception& e) { failure = e.what(); }
    stop = true; thread.join();
    totalAttempts += attempts; conversions += sets; clears += removed; parentMoves += moves;
    compareCanary(before, name + "-round-" + std::to_string(round)); require(failure.empty(), failure.c_str());
    require(sameId(parentId, rawInfo(parent)) && moves == 0, "ancestor replacement succeeded");
    if (status >= 0) ++successfulCreates; else ++refusals;
  }
  require(conversions > 0 && clears > 0, "UNPROVEN: adversary never converted/reset empty root");
  compareCanary(before, name);
  std::cout << "RACE level=" << level << " fresh-empty-rounds=64 attempts=" << totalAttempts << " conversions=" << conversions << " resets=" << clears
    << " ancestor-renames=" << parentMoves << " created=" << successfulCreates << " refused=" << refusals << std::endl; ++passedCases;
}
void fileAuthority() {
  auto p = fresh(L"file-authority"); Chain chain(p); auto f = mustCreate(chain.leaf(), L"payload", false, p + L"\\payload");
  const auto id = rawInfo(f.h); const auto before = inventory(canary); saveInventory(before, "file-authority-before.txt");
  const auto moved = p + L"\\swapped", alias = p + L"\\alias"; mutationGuard(moved); mutationGuard(alias);
  std::atomic<bool> stop{false}; std::atomic<unsigned> attempts{0}, moves{0}, links{0}, writers{0}, reparses{0};
  std::thread attacker([&] {
    while (!stop || attempts < 1000) {
      if (MoveFileExW((p + L"\\payload").c_str(), moved.c_str(), 0)) ++moves;
      if (CreateHardLinkW(alias.c_str(), (p + L"\\payload").c_str(), nullptr)) ++links;
      Handle write(CreateFileW((p + L"\\payload").c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
        nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
      if (write.h != INVALID_HANDLE_VALUE) ++writers;
      if (setMount(f.h)) ++reparses; // adversary metadata call on SAME object, never an external path
      ++attempts;
    }
  });
  std::string failure;
  try { for (unsigned n = 0; n < 32; ++n) { LARGE_INTEGER zero{}; require(SetFilePointerEx(f.h, zero, nullptr, FILE_BEGIN) != 0, "seek"); writeNew(f.h, bytes("retained file payload")); } }
  catch (const std::exception& e) { failure = e.what(); }
  stop = true; attacker.join(); compareCanary(before, "file-authority"); require(failure.empty(), failure.c_str());
  require(sameId(id, rawInfo(f.h)) && rawInfo(f.h).nNumberOfLinks == 1 && read(f.h) == bytes("retained file payload"), "retained file bytes/identity changed");
  require(moves == 0 && links == 0 && writers == 0 && reparses == 0, "target replacement/aliasing not excluded");
  std::cout << "FILE_AUTHORITY attempts=" << attempts << " moves=" << moves << " aliases=" << links << " writer-opens=" << writers << " reparse=" << reparses << " PASS" << std::endl; ++passedCases;
}
void setupApis() {
  auto ntdll = GetModuleHandleW(L"ntdll.dll"); createNt = reinterpret_cast<CreateFn>(GetProcAddress(ntdll, "NtCreateFile")); require(createNt != nullptr, "NtCreateFile unavailable");
}
std::wstring tempBase() {
  wchar_t temp[256]{}; require(GetEnvironmentVariableW(L"RUNNER_TEMP", temp, 256) > 0, "isolated CI RUNNER_TEMP required");
  std::wstring base(temp); while (!base.empty() && base.back() == L'\\') base.pop_back(); absolute(base); return base;
}
void partialChild(const std::wstring& value) {
  require(beneath(value, tempBase()) && fs::path(value).filename().wstring().starts_with(L"cp2-create-"), "wrong disposable child suite");
  suite = value; mutation = suite + L"\\mutation"; recovery = suite + L"\\recovery"; canary = suite + L"\\canary";
  auto p = mutation + L"\\partial-generation"; Chain parent(mutation);
  auto gen = mustCreate(parent.leaf(), L"partial-generation", true, p);
  auto file = mustCreate(gen.h, L"partial.bin", false, p + L"\\partial.bin"); writeNew(file.h, bytes("identifiable incomplete generation"));
  // Actual process interruption without destructors/promotion/commit marker.
  ExitProcess(77);
}
void interruption() {
  auto old = fresh(L"old-fixture"); seed(old + L"\\owned", "old application fixture"); makeDir(old + L"\\unknown"); seed(old + L"\\unknown\\user", "user fixture bytes");
  const auto oldBefore = inventory(old), before = inventory(canary); saveInventory(oldBefore, "old-fixture-before.txt"); saveInventory(before, "interruption-before.txt");
  wchar_t exe[1024]{}; require(GetModuleFileNameW(nullptr, exe, 1024) > 0, "self executable unavailable");
  std::wstring cmd = L"\"" + std::wstring(exe) + L"\" --partial \"" + suite + L"\"";
  STARTUPINFOW si{}; si.cb = sizeof(si); PROCESS_INFORMATION pi{};
  require(CreateProcessW(exe, cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi) != 0, "partial child start failed");
  Handle process(pi.hProcess), thread(pi.hThread); require(WaitForSingleObject(process.h, 30000) == WAIT_OBJECT_0, "partial child timeout");
  DWORD exit = 0; require(GetExitCodeProcess(process.h, &exit) != 0 && exit == 77, "wrong interruption status");
  const auto partial = mutation + L"\\partial-generation"; const auto content = inventory(partial);
  require(content.size() == 1 && content.contains(L"partial.bin") && !fs::exists(fs::path(partial) / L"COMMITTED"), "partial generation incorrectly committed");
  const auto oldAfter = inventory(old); saveInventory(oldAfter, "old-fixture-after.txt"); saveInventory(content, "partial-generation.txt");
  require(oldBefore == oldAfter, "old fixture modified by interruption"); compareCanary(before, "interruption");
  std::cout << "INTERRUPTION exit=77 old-fixture-identical incomplete-files=1 committed=false rollback=none" << std::endl; ++passedCases;
}
int wmain(int argc, wchar_t** argv) {
  try {
    setupApis(); if (argc == 3 && std::wstring(argv[1]) == L"--partial") { partialChild(argv[2]); return 2; }
    require(argc == 1, "unsupported prototype invocation");
    wchar_t output[512]{}; require(GetEnvironmentVariableW(L"CP2_EVIDENCE", output, 512) > 0, "evidence path required"); evidence = output;
    auto base = tempBase(); require(beneath(evidence, base), "evidence outside CI temp");
    suite = base + L"\\cp2-create-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64());
    {
      Chain parent(base); auto root = child(parent.leaf(), fs::path(suite).filename().wstring(), true, FILE_LIST_DIRECTORY, createNew);
      auto m = child(root.h, L"mutation", true, FILE_LIST_DIRECTORY, createNew); auto r = child(root.h, L"recovery", true, FILE_LIST_DIRECTORY, createNew);
      auto c = child(root.h, L"canary", true, FILE_LIST_DIRECTORY, createNew);
      auto f = child(c.h, L"outside.txt", false, FILE_READ_DATA | FILE_WRITE_DATA, createNew); writeNew(f.h, bytes("external disposable canary"));
      auto d = child(c.h, L"UserFolder", true, FILE_LIST_DIRECTORY, createNew);
      auto g = child(d.h, L"another.txt", false, FILE_READ_DATA | FILE_WRITE_DATA, createNew); writeNew(g.h, bytes("nested external canary"));
      auto empty = child(c.h, L"EmptyFolder", true, FILE_LIST_DIRECTORY, createNew);
    }
    mutation = suite + L"\\mutation"; recovery = suite + L"\\recovery"; canary = suite + L"\\canary";
    wchar_t volumeGuid[128]{}, fsName[32]{}; const auto volume = suite.substr(0, 3);
    require(GetVolumeInformationW(volume.c_str(), nullptr, 0, nullptr, nullptr, nullptr, fsName, 32) != 0 && std::wstring(fsName) == L"NTFS", "NTFS required");
    require(GetVolumeNameForVolumeMountPointW(volume.c_str(), volumeGuid, 128) != 0, "volume GUID unavailable");
    std::cout << "ENVIRONMENT filesystem=NTFS fixed-local volume-guid=" << ascii(volumeGuid) << " suite=" << ascii(suite) << std::endl;
    const auto initial = inventory(canary); saveInventory(initial, "canary-initial.txt");
    invalidInputs(); normalAndCollisions(); intermediateParse();
    for (const auto& model : {guarded, parseOnly, leafOnly}) for (unsigned level = 0; level < 4; ++level)
      for (bool directory : {false, true}) deterministicRoot(model, level, directory);
    for (unsigned level = 0; level < 4; ++level) sustained(level);
    fileAuthority(); interruption(); compareCanary(initial, "final");
    std::cout << "CREATE_ONLY_GATE=PASSED cases=" << passedCases << " no-installer/no-registry/no-cleanup/no-rename" << std::endl; return 0;
  } catch (const std::exception& failure) {
    std::cerr << "CREATE_ONLY_GATE=UNPROVEN_OR_FAILED " << failure.what() << " win32=" << GetLastError() << std::endl; return 1;
  }
}
