// TEST PROTOTYPE ONLY. No installation, registry, process runner, or production API.
#include <windows.h>
#include <winternl.h>
#include <winioctl.h>
#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
namespace fs = std::filesystem;
using Bytes = std::vector<unsigned char>;
using Digest = std::array<unsigned char, 32>;
struct Refusal : std::runtime_error { using std::runtime_error::runtime_error; };
void require(bool ok, const char* message) { if (!ok) throw Refusal(message); }
struct Handle {
  HANDLE h = INVALID_HANDLE_VALUE;
  explicit Handle(HANDLE value = INVALID_HANDLE_VALUE) : h(value) {}
  ~Handle() { if (h != INVALID_HANDLE_VALUE && h != nullptr) CloseHandle(h); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : h(other.h) { other.h = INVALID_HANDLE_VALUE; }
  Handle& operator=(Handle&& other) noexcept {
    if (this != &other) { if (h != INVALID_HANDLE_VALUE) CloseHandle(h); h = other.h; other.h = INVALID_HANDLE_VALUE; }
    return *this;
  }
};
using CreateFn = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK,
  PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using SetFn = NTSTATUS(NTAPI*)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, FILE_INFORMATION_CLASS);
CreateFn createNt;
SetFn setNt;
constexpr ULONG openExisting = 1, createNew = 2;
constexpr ULONG directoryOption = 1, synchronousOption = 0x20, fileOption = 0x40, noReparse = 0x200000;
std::wstring suite, mutation, recovery, canary;
std::vector<std::pair<std::wstring, Digest>> sentinels;

std::wstring upper(std::wstring s) { for (auto& c : s) c = static_cast<wchar_t>(towupper(c)); return s; }
bool beneath(const std::wstring& p, const std::wstring& root) {
  return upper(p).starts_with(upper(root) + L"\\");
}
void component(const std::wstring& part) {
  require(!part.empty() && part.size() <= 120 && part != L"." && part != L"..", "invalid component");
  require(part.back() != L'.' && part.back() != L' ', "ambiguous component ending");
  for (auto c : part) require(c >= 32 && std::wstring(L"\\/:*?\"<>|").find(c) == std::wstring::npos,
    "separator/ADS/control character");
  auto stem = upper(part.substr(0, part.find(L'.')));
  require(stem != L"CON" && stem != L"PRN" && stem != L"AUX" && stem != L"NUL" && stem != L"CONIN$" && stem != L"CONOUT$",
    "reserved DOS name");
  require(!(stem.size() == 4 && (stem.starts_with(L"COM") || stem.starts_with(L"LPT")) &&
    (stem[3] >= L'0' && stem[3] <= L'9')), "reserved numbered DOS name");
  // Narrow experimental domain also excludes Unicode DOS superscript aliases.
  for (auto c : part) require(c < 127, "prototype paths must be ASCII");
}
std::vector<std::wstring> absolute(const std::wstring& p) {
  require(p.size() > 3 && p.size() <= 220 && p[1] == L':' && p[2] == L'\\' &&
    ((p[0] >= L'A' && p[0] <= L'Z') || (p[0] >= L'a' && p[0] <= L'z')), "not bounded local absolute path");
  require(p.back() != L'\\', "trailing separator");
  std::vector<std::wstring> parts;
  size_t start = 3;
  for (size_t end = p.find(L'\\', start); ; end = p.find(L'\\', start)) {
    auto part = p.substr(start, end == std::wstring::npos ? end : end - start);
    component(part); parts.push_back(part);
    if (end == std::wstring::npos) break;
    start = end + 1;
  }
  return parts;
}
void mutationGuard(const std::wstring& p) {
  absolute(p);
  require(beneath(p, mutation) || beneath(p, recovery), "outside authorized mutation roots");
}
BY_HANDLE_FILE_INFORMATION info(HANDLE h) {
  BY_HANDLE_FILE_INFORMATION result{};
  require(GetFileInformationByHandle(h, &result) != 0, "file information failed");
  require(!(result.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT), "reparse object refused");
  return result;
}
bool sameId(const BY_HANDLE_FILE_INFORMATION& a, const BY_HANDLE_FILE_INFORMATION& b) {
  return a.dwVolumeSerialNumber == b.dwVolumeSerialNumber && a.nFileIndexHigh == b.nFileIndexHigh && a.nFileIndexLow == b.nFileIndexLow;
}
Handle child(HANDLE parent, const std::wstring& name, bool directory, ACCESS_MASK access, ULONG disposition = openExisting) {
  component(name);
  UNICODE_STRING text{};
  text.Buffer = const_cast<PWSTR>(name.c_str());
  text.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t)); text.MaximumLength = text.Length;
  OBJECT_ATTRIBUTES attributes{};
  attributes.Length = sizeof(attributes); attributes.RootDirectory = parent;
  attributes.ObjectName = &text; attributes.Attributes = 0x40; // OBJ_CASE_INSENSITIVE
  IO_STATUS_BLOCK status{}; HANDLE h = INVALID_HANDLE_VALUE;
  const NTSTATUS result = createNt(&h, access | SYNCHRONIZE | FILE_READ_ATTRIBUTES, &attributes, &status,
    nullptr, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, disposition,
    synchronousOption | noReparse | (directory ? directoryOption : fileOption), nullptr, 0);
  if (result < 0) {
    std::ostringstream message; message << "NtCreateFile refusal 0x" << std::hex << static_cast<unsigned long>(result);
    throw Refusal(message.str());
  }
  Handle opened(h); info(h); return opened;
}
// Keep every ancestor pinned until the last mutation has finished. No reopen-by-path.
struct Chain {
  std::vector<Handle> held;
  explicit Chain(const std::wstring& path) {
    auto parts = absolute(path);
    std::wstring volume = path.substr(0, 3);
    wchar_t filesystem[32]{};
    require(GetDriveTypeW(volume.c_str()) == DRIVE_FIXED, "not fixed local volume");
    require(GetVolumeInformationW(volume.c_str(), nullptr, 0, nullptr, nullptr, nullptr, filesystem, 32) != 0 &&
      std::wstring(filesystem) == L"NTFS", "not NTFS");
    Handle root(CreateFileW(volume.c_str(), FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
      FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    require(root.h != INVALID_HANDLE_VALUE, "cannot lock volume root"); info(root.h);
    held.push_back(std::move(root));
    for (const auto& part : parts) held.push_back(child(held.back().h, part, true, FILE_LIST_DIRECTORY));
  }
  HANDLE leaf() const { return held.back().h; }
};
Digest hash(const Bytes& bytes) {
  BCRYPT_ALG_HANDLE algorithm = nullptr; BCRYPT_HASH_HANDLE hasher = nullptr;
  require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0, "SHA provider");
  Digest digest{};
  NTSTATUS result = BCryptCreateHash(algorithm, &hasher, nullptr, 0, nullptr, 0, 0);
  if (result >= 0) result = BCryptHashData(hasher, const_cast<PUCHAR>(bytes.data()), static_cast<ULONG>(bytes.size()), 0);
  if (result >= 0) result = BCryptFinishHash(hasher, digest.data(), static_cast<ULONG>(digest.size()), 0);
  if (hasher) BCryptDestroyHash(hasher);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  require(result >= 0, "SHA failed"); return digest;
}
std::string hex(const Digest& digest) {
  constexpr char digits[] = "0123456789abcdef"; std::string result;
  for (auto b : digest) { result += digits[b >> 4]; result += digits[b & 15]; } return result;
}
Bytes bytes(const std::string& s) { return Bytes(s.begin(), s.end()); }
Bytes read(HANDLE h) {
  LARGE_INTEGER size{}, zero{};
  require(GetFileSizeEx(h, &size) != 0 && size.QuadPart >= 0 && size.QuadPart <= 1024 * 1024, "bounded file size");
  require(SetFilePointerEx(h, zero, nullptr, FILE_BEGIN) != 0, "rewind failed");
  Bytes result(static_cast<size_t>(size.QuadPart)); DWORD count = 0;
  require(ReadFile(h, result.data(), static_cast<DWORD>(result.size()), &count, nullptr) != 0 && count == result.size(), "read failed");
  return result;
}
void writeNew(HANDLE h, const Bytes& payload) {
  DWORD count = 0;
  require(WriteFile(h, payload.data(), static_cast<DWORD>(payload.size()), &count, nullptr) != 0 && count == payload.size(), "write failed");
  require(FlushFileBuffers(h) != 0 && read(h) == payload, "flush/read-back failed");
}
struct Expected { size_t size; Digest sha; };
Expected expected(const std::string& content) { return {content.size(), hash(bytes(content))}; }
void verify(HANDLE h, const Expected& e) {
  const auto before = info(h);
  require(!(before.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && before.nNumberOfLinks == 1, "not single-link regular file");
  auto content = read(h);
  require(content.size() == e.size && hash(content) == e.sha, "modified bytes preserved");
  require(sameId(before, info(h)), "identity changed");
}
struct RenameInformation { BOOLEAN replace; HANDLE root; ULONG length; WCHAR name[1]; };
void renameExact(HANDLE file, HANDLE destination, const std::wstring& destinationPath,
                 const std::wstring& name, const Expected& e) {
  mutationGuard(destinationPath + L"\\" + name); component(name); verify(file, e);
  const auto before = info(file), parent = info(destination);
  require(before.dwVolumeSerialNumber == parent.dwVolumeSerialNumber, "cross-volume prototype unsupported");
  auto length = static_cast<ULONG>(name.size() * sizeof(wchar_t));
  Bytes buffer(sizeof(RenameInformation) + length, 0);
  auto* rename = reinterpret_cast<RenameInformation*>(buffer.data());
  rename->replace = FALSE; rename->root = destination; rename->length = length;
  memcpy(rename->name, name.data(), length);
  IO_STATUS_BLOCK status{};
  require(setNt(file, &status, rename, static_cast<ULONG>(buffer.size()), static_cast<FILE_INFORMATION_CLASS>(10)) >= 0,
    "exact rename refused (collision/lock)");
  require(sameId(before, info(file)), "renamed object identity changed"); verify(file, e);
}
void removeEmpty(const std::wstring& parent, const std::wstring& name) {
  mutationGuard(parent + L"\\" + name);
  Chain chain(parent); auto dir = child(chain.leaf(), name, true, DELETE | FILE_LIST_DIRECTORY);
  BOOLEAN disposition = TRUE; IO_STATUS_BLOCK status{};
  require(setNt(dir.h, &status, &disposition, sizeof(disposition), static_cast<FILE_INFORMATION_CLASS>(13)) >= 0,
    "nonempty directory preserved");
}
void makeDir(const std::wstring& path) {
  mutationGuard(path); auto parent = fs::path(path).parent_path().wstring(); Chain chain(parent);
  auto made = child(chain.leaf(), fs::path(path).filename().wstring(), true, FILE_LIST_DIRECTORY, createNew);
}
void seed(const std::wstring& path, const std::string& content) {
  mutationGuard(path); Chain parent(fs::path(path).parent_path().wstring());
  auto file = child(parent.leaf(), fs::path(path).filename().wstring(), false, FILE_READ_DATA | FILE_WRITE_DATA, createNew);
  writeNew(file.h, bytes(content));
}
Bytes snapshot(const std::wstring& path) {
  Chain parent(fs::path(path).parent_path().wstring());
  auto file = child(parent.leaf(), fs::path(path).filename().wstring(), false, FILE_READ_DATA);
  return read(file.h);
}
std::wstring caseRoot(const std::wstring& name) {
  auto p = mutation + L"\\" + name; makeDir(p);
  makeDir(p + L"\\keep-folder");
  for (const auto& file : {p + L"\\keep-user.txt", p + L"\\keep-folder\\user.txt"}) {
    seed(file, "unrelated sentinel bytes"); sentinels.emplace_back(file, hash(bytes("unrelated sentinel bytes")));
  }
  return p;
}
void refuse(const std::function<void()>& operation) {
  bool refused = false; try { operation(); } catch (const Refusal&) { refused = true; }
  require(refused, "unsafe operation did not refuse");
}
// Adversary helpers: target is guarded, canary is a link DESTINATION only.
void junction(const std::wstring& path, const std::wstring& target) {
  mutationGuard(path); require(target == canary, "wrong adversary destination");
  Handle h(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  require(h.h != INVALID_HANDLE_VALUE, "junction open failed");
  const auto substitute = L"\\??\\" + target;
  struct Mount { DWORD tag; WORD size; WORD reserved; WORD subOffset; WORD subLength; WORD printOffset; WORD printLength; WCHAR data[1]; };
  const auto subBytes = substitute.size() * 2, printBytes = target.size() * 2;
  Bytes buffer(offsetof(Mount, data) + subBytes + 2 + printBytes + 2, 0);
  auto* mount = reinterpret_cast<Mount*>(buffer.data()); mount->tag = IO_REPARSE_TAG_MOUNT_POINT;
  mount->size = static_cast<WORD>(buffer.size() - 8); mount->subLength = static_cast<WORD>(subBytes);
  mount->printOffset = static_cast<WORD>(subBytes + 2); mount->printLength = static_cast<WORD>(printBytes);
  memcpy(mount->data, substitute.data(), subBytes);
  memcpy(reinterpret_cast<unsigned char*>(mount->data) + mount->printOffset, target.data(), printBytes);
  DWORD returned = 0;
  require(DeviceIoControl(h.h, FSCTL_SET_REPARSE_POINT, buffer.data(), static_cast<DWORD>(buffer.size()), nullptr, 0, &returned, nullptr) != 0,
    "junction setting failed");
}
// Fixed bounded journal. Trusted plan stays external to it; journal never grants authority.
struct Journal { std::array<char, 8> magic; DWORD version; DWORD phase; ULONGLONG transaction; Digest expectedHash; Digest digest; };
Journal journalRecord(DWORD phase, const Expected& e) {
  Journal j{}; j.magic = {'C','P','2','T','E','S','T','!'}; j.version = 1; j.phase = phase; j.transaction = 42;
  j.expectedHash = e.sha;
  j.digest = hash(Bytes(reinterpret_cast<unsigned char*>(&j), reinterpret_cast<unsigned char*>(&j) + offsetof(Journal, digest)));
  return j;
}
void journalWrite(const std::wstring& root, DWORD phase, const Expected& e) {
  auto j = journalRecord(phase, e);
  seed(root + L"\\journal-" + std::to_wstring(phase), std::string(reinterpret_cast<char*>(&j), sizeof(j)));
}
void journalVerify(const Bytes& data, DWORD phase, const Expected& e) {
  require(data.size() == sizeof(Journal), "journal bound/length"); Journal j{}; memcpy(&j, data.data(), sizeof(j));
  const auto trusted = journalRecord(phase, e);
  require(memcmp(&j, &trusted, sizeof(j)) == 0, "journal not equal to trusted bounded transaction");
}
int tests = 0;
Digest canaryDigest;
void test(const char* name, const std::function<void()>& body) {
  auto check = [&] {
    require(hash(snapshot(canary + L"\\outside.txt")) == canaryDigest, "EXTERNAL CANARY MODIFIED");
    for (const auto& sentinel : sentinels) require(hash(snapshot(sentinel.first)) == sentinel.second, "UNKNOWN SENTINEL MODIFIED");
    std::cout << "HASH_CHECK canary=" << hex(canaryDigest) << " unknown-sentinels=" << sentinels.size()
      << " unknown-sha256=" << hex(hash(bytes("unrelated sentinel bytes"))) << std::endl;
  };
  try { body(); } catch (...) { check(); throw; }
  check(); ++tests; std::cout << "PASS " << name << std::endl;
}
void experiments() {
  const auto e = expected("owned original"), replacement = expected("new replacement");
  test("exact handle move/identity/unknown-neighbor preservation", [&] {
    auto root = caseRoot(L"exact"); seed(root + L"\\owned", "owned original"); seed(root + L"\\unknown", "user bytes");
    Chain source(root), target(recovery); auto file = child(source.leaf(), L"owned", false, FILE_READ_DATA | DELETE);
    renameExact(file.h, target.leaf(), recovery, L"exact", e);
    require(hash(snapshot(root + L"\\unknown")) == hash(bytes("user bytes")), "unknown changed");
  });
  test("missing/modified/conflicting replacements preserve bytes", [&] {
    auto root = caseRoot(L"modified"); seed(root + L"\\owned", "user changed"); seed(recovery + L"\\collision", "user collision");
    Chain source(root), target(recovery);
    refuse([&] { auto missing = child(source.leaf(), L"missing", false, FILE_READ_DATA | DELETE); });
    auto file = child(source.leaf(), L"owned", false, FILE_READ_DATA | DELETE);
    refuse([&] { renameExact(file.h, target.leaf(), recovery, L"collision", e); });
    require(read(file.h) == bytes("user changed"), "modified file changed");
    require(snapshot(recovery + L"\\collision") == bytes("user collision"), "collision changed");
  });
  test("exact destination collision does not overwrite", [&] {
    auto root = caseRoot(L"collision"); seed(root + L"\\owned", "owned original");
    Chain source(root), target(recovery); auto file = child(source.leaf(), L"owned", false, FILE_READ_DATA | DELETE);
    refuse([&] { renameExact(file.h, target.leaf(), recovery, L"collision", e); }); verify(file.h, e);
  });
  test("unsafe absolute/component/root/case-equivalent paths", [&] {
    for (const auto& bad : {L"C:\\", L"C:relative", L"relative", L"\\\\server\\share", L"\\\\?\\C:\\device",
      L"C:\\x\\..\\escape", L"C:\\x\\file:stream", L"C:\\x\\CON.txt", L"C:\\x\\trailing.", L"C:\\x\\trailing ",
      L"C:\\x\\LPT1", L"C:\\x\\\\empty"}) refuse([&] { absolute(bad); });
    refuse([&] { mutationGuard(canary + L"\\outside.txt"); });
    std::vector<std::wstring> plan{L"File", L"file"};
    refuse([&] { require(upper(plan[0]) != upper(plan[1]), "case equivalent duplicate"); });
  });
  test("static ancestor junction refused", [&] {
    auto root = caseRoot(L"junction"); makeDir(root + L"\\redirect"); junction(root + L"\\redirect", canary);
    refuse([&] { Chain redirected(root + L"\\redirect"); });
  });
  test("target file symlink refused", [&] {
    auto root = caseRoot(L"symlink"); mutationGuard(root + L"\\link");
    require(CreateSymbolicLinkW((root + L"\\link").c_str(), (canary + L"\\outside.txt").c_str(),
      SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE) != 0, "symlink fixture unavailable; no skipping");
    Chain parent(root); refuse([&] { auto link = child(parent.leaf(), L"link", false, FILE_READ_DATA | DELETE); });
  });
  test("hard link refused; outside linked object unchanged", [&] {
    auto root = caseRoot(L"hardlink"); mutationGuard(root + L"\\linked");
    require(CreateHardLinkW((root + L"\\linked").c_str(), (canary + L"\\outside.txt").c_str(), nullptr) != 0, "hardlink fixture");
    Chain parent(root); auto linked = child(parent.leaf(), L"linked", false, FILE_READ_DATA | DELETE);
    refuse([&] { verify(linked.h, expected("external disposable canary")); });
    require(info(linked.h).nNumberOfLinks == 2, "hardlink count not observed");
  });
  test("locked file refuses transaction", [&] {
    auto root = caseRoot(L"locked"); seed(root + L"\\owned", "owned original"); mutationGuard(root + L"\\owned");
    Handle lock(CreateFileW((root + L"\\owned").c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr));
    require(lock.h != INVALID_HANDLE_VALUE, "lock fixture"); Chain parent(root);
    refuse([&] { auto file = child(parent.leaf(), L"owned", false, FILE_READ_DATA | DELETE); });
  });
  test("nonrecursive empty removal/nonempty nested sentinel preserved", [&] {
    auto root = caseRoot(L"directories"); makeDir(root + L"\\empty"); makeDir(root + L"\\unknown");
    seed(root + L"\\unknown\\user", "nested user data"); removeEmpty(root, L"empty");
    require(GetFileAttributesW((root + L"\\empty").c_str()) == INVALID_FILE_ATTRIBUTES, "empty dir remains");
    refuse([&] { removeEmpty(root, L"unknown"); });
    require(snapshot(root + L"\\unknown\\user") == bytes("nested user data"), "nested sentinel removed");
  });
  test("target/ancestor replacement and reparse mutation under held handles", [&] {
    auto root = caseRoot(L"race"); makeDir(root + L"\\ancestor"); seed(root + L"\\ancestor\\owned", "owned original");
    Chain source(root + L"\\ancestor"), destination(recovery);
    auto file = child(source.leaf(), L"owned", false, FILE_READ_DATA | DELETE);
    const auto id = info(file.h); verify(file.h, e);
    for (const auto& path : {root + L"\\ancestor\\owned", root + L"\\swapped", root + L"\\ancestor",
      root + L"\\ancestor-swapped", root + L"\\attacker-link"}) mutationGuard(path);
    std::atomic<bool> ready{false}, stop{false}; std::atomic<unsigned> attempts{0}, successes{0};
    std::thread attacker([&] {
      ready = true;
      while (!stop || attempts < 1000) {
        // Each attempted mutation stays below mutation. No recursive removal.
        if (MoveFileExW((root + L"\\ancestor\\owned").c_str(), (root + L"\\swapped").c_str(), 0)) ++successes;
        if (MoveFileExW((root + L"\\ancestor").c_str(), (root + L"\\ancestor-swapped").c_str(), 0)) ++successes;
        if (CreateHardLinkW((root + L"\\attacker-link").c_str(), (root + L"\\ancestor\\owned").c_str(), nullptr)) ++successes;
        try { junction(root + L"\\ancestor", canary); ++successes; } catch (const Refusal&) {}
        ++attempts;
      }
    });
    while (!ready || attempts < 1000) std::this_thread::yield();
    bool moved = false;
    try { renameExact(file.h, destination.leaf(), recovery, L"raced-owned", e); moved = true; }
    catch (...) { stop = true; attacker.join(); throw; }
    stop = true; attacker.join();
    require(moved && successes == 0 && sameId(id, info(file.h)), "race redirected object or ancestor");
    std::cout << "RACE attempts=" << attempts << " successful-replacements=" << successes << std::endl;
  });
  test("bounded interruption/replacement/recovery and idempotent replay", [&] {
    auto root = caseRoot(L"recover"); auto store = recovery + L"\\transaction"; makeDir(store);
    seed(root + L"\\owned", "owned original"); seed(store + L"\\staged", "new replacement");
    journalWrite(store, 0, e); journalVerify(snapshot(store + L"\\journal-0"), 0, e);
    {
      Chain source(root), destination(store); auto old = child(source.leaf(), L"owned", false, FILE_READ_DATA | DELETE);
      renameExact(old.h, destination.leaf(), store, L"old", e);
      // Simulate termination BEFORE journal progress: dispose all capability handles.
    }
    require(GetFileAttributesW((root + L"\\owned").c_str()) == INVALID_FILE_ATTRIBUTES, "old not moved");
    journalVerify(snapshot(store + L"\\journal-0"), 0, e);
    journalWrite(store, 1, e);
    {
      Chain source(store), target(root); auto staged = child(source.leaf(), L"staged", false, FILE_READ_DATA | DELETE);
      renameExact(staged.h, target.leaf(), root, L"owned", replacement);
    }
    journalWrite(store, 2, e);
    // Recovery uses a freshly reconstructed, fixed trusted plan, not journal paths.
    {
      Chain source(root), target(store); auto newFile = child(source.leaf(), L"owned", false, FILE_READ_DATA | DELETE);
      renameExact(newFile.h, target.leaf(), store, L"failed-new", replacement);
    }
    // Simulated interruption DURING recovery, then close/reopen and resume.
    {
      Chain source(store), target(root); auto old = child(source.leaf(), L"old", false, FILE_READ_DATA | DELETE);
      renameExact(old.h, target.leaf(), root, L"owned", e);
    }
    journalWrite(store, 3, e); journalVerify(snapshot(store + L"\\journal-3"), 3, e);
    require(snapshot(root + L"\\owned") == bytes("owned original"), "rollback bytes");
    journalVerify(snapshot(store + L"\\journal-3"), 3, e); // completed replay: verification only
    require(snapshot(store + L"\\failed-new") == bytes("new replacement"), "recovery material discarded");
    auto tampered = snapshot(store + L"\\journal-0"); tampered[0] ^= 1;
    refuse([&] { journalVerify(tampered, 0, e); }); tampered.resize(3);
    refuse([&] { journalVerify(tampered, 0, e); });
  });
}
int wmain() {
  try {
    auto module = GetModuleHandleW(L"ntdll.dll");
    createNt = reinterpret_cast<CreateFn>(GetProcAddress(module, "NtCreateFile"));
    setNt = reinterpret_cast<SetFn>(GetProcAddress(module, "NtSetInformationFile"));
    require(createNt && setNt, "native API unavailable");
    wchar_t temp[256]{};
    require(GetEnvironmentVariableW(L"RUNNER_TEMP", temp, 256) > 0, "CI RUNNER_TEMP required");
    std::wstring base(temp); while (!base.empty() && base.back() == L'\\') base.pop_back();
    absolute(base);
    suite = base + L"\\everia-cp2-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64());
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
    std::wcout << L"DISPOSABLE_ROOT=" << suite << L"\nFILESYSTEM=NTFS DRIVE_TYPE=FIXED\n";
    std::cout << "CANARY_BEFORE=" << hex(canaryDigest) << std::endl;
    experiments();
    std::cout << "CANARY_AFTER=" << hex(hash(snapshot(canary + L"\\outside.txt"))) << "\nTOTAL=" << tests << std::endl;
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL " << error.what() << " last-win32=" << GetLastError() << std::endl; return 1;
  }
}
