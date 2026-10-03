// Tests only. The production library has no adversarial hooks or executable
// API.
#include "internal.hpp"
#include <atomic>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <thread>
#include <winioctl.h>
namespace fs = std::filesystem;
using namespace everia::generation;
using namespace everia::generation::detail;
namespace {
std::wstring suite, mutation, canary, old, evidence, payload;
unsigned sequence = 0, passed = 0;
std::string baseline, old_baseline;
void require(bool b, const char *message) {
  if (!b)
    throw std::runtime_error(message);
}
bool below(const std::wstring &p, const std::wstring &base) {
  return upper(p).starts_with(upper(base) + L"\\");
}
void guard(const std::wstring &p) {
  absolute(p);
  require(below(p, mutation), "TEST OUTSIDE MUTATION ROOT");
}
void mkdir(const std::wstring &p) {
  guard(p);
  require(CreateDirectoryW(p.c_str(), nullptr) != 0, "fixture mkdir failed");
}
std::wstring fresh() {
  auto p = mutation + L"\\case-" + std::to_wstring(++sequence);
  mkdir(p);
  return p;
}
void put(const std::wstring &p, const std::string &data) {
  guard(p);
  Handle h(CreateFileW(p.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                       CREATE_NEW, 0, nullptr));
  require(h.value != INVALID_HANDLE_VALUE, "fixture exclusive file failed");
  write_small(h.value, data);
}
void replace_bytes(const std::wstring &p, const std::string &data) {
  guard(p);
  Handle h(CreateFileW(p.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                       OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  require(h.value != INVALID_HANDLE_VALUE, "tamper fixture open failed");
  regular(h.value, false);
  LARGE_INTEGER zero{};
  require(SetFilePointerEx(h.value, zero, nullptr, FILE_BEGIN) &&
              SetEndOfFile(h.value),
          "tamper truncate failed");
  write_small(h.value, data);
}
std::string snapshot(const std::wstring &root) {
  std::map<std::string, std::string> entries;
  for (const auto &f : fs::recursive_directory_iterator(root)) {
    require(!fs::is_symlink(f.symlink_status()), "canary symlink");
    auto r = f.path().lexically_relative(root).generic_string();
    if (f.is_directory())
      entries[r] = "D";
    else {
      Handle h(CreateFileW(f.path().c_str(), GENERIC_READ, FILE_SHARE_READ,
                           nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT,
                           nullptr));
      require(h.value != INVALID_HANDLE_VALUE, "canary read failed");
      auto n = f.file_size();
      entries[r] = "F\t" + std::to_string(n) + "\t" + hash_file(h.value, n);
    }
  }
  std::string s;
  for (const auto &[p, v] : entries)
    s += p + "\t" + v + "\n";
  return s;
}
void save(const std::string &label, const std::string &data) {
  std::ofstream f(fs::path(evidence) / label, std::ios::binary);
  require(bool(f), "evidence write failed");
  f << data;
  require(bool(f), "evidence write incomplete");
}
void canary_check(const std::string &name) {
  auto after = snapshot(canary);
  save(name + "-canary-after.txt", after);
  require(after == baseline, "EXTERNAL CANARY MUTATION");
  auto old_after = snapshot(old);
  save(name + "-old-after.txt", old_after);
  require(old_after == old_baseline, "OLD FIXTURE MUTATION");
}
void test(const std::string &name, const std::function<void()> &fn) {
  save(name + "-canary-before.txt", snapshot(canary));
  fn();
  canary_check(name);
  ++passed;
  std::cout << "PASS " << name << std::endl;
}
template <class F> void refused(F &&fn) {
  bool b = false;
  try {
    fn();
  } catch (const Error &e) {
    b = true;
    std::cout << "REFUSAL " << e.code << std::endl;
  }
  require(b, "expected refusal");
}
Handle attacker(const std::wstring &p, DWORD access = FILE_WRITE_ATTRIBUTES) {
  guard(p);
  return Handle(CreateFileW(
      p.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
      nullptr));
}
bool mount(HANDLE h) {
  const auto sub = L"\\??\\" + canary;
  struct Mount {
    DWORD tag;
    WORD size, reserved, subOffset, subLength, printOffset, printLength;
    WCHAR data[1];
  };
  auto a = sub.size() * 2, b = canary.size() * 2;
  Bytes bytes(offsetof(Mount, data) + a + 2 + b + 2, 0);
  auto *m = reinterpret_cast<Mount *>(bytes.data());
  m->tag = IO_REPARSE_TAG_MOUNT_POINT;
  m->size = static_cast<WORD>(bytes.size() - 8);
  m->subLength = static_cast<WORD>(a);
  m->printOffset = static_cast<WORD>(a + 2);
  m->printLength = static_cast<WORD>(b);
  memcpy(m->data, sub.data(), a);
  memcpy(reinterpret_cast<unsigned char *>(m->data) + m->printOffset,
         canary.data(), b);
  DWORD n = 0;
  return DeviceIoControl(h, FSCTL_SET_REPARSE_POINT, bytes.data(),
                         static_cast<DWORD>(bytes.size()), nullptr, 0, &n,
                         nullptr) != 0;
}
bool unmount(HANDLE h) {
  struct {
    DWORD tag;
    WORD size, reserved;
  } b{IO_REPARSE_TAG_MOUNT_POINT, 0, 0};
  DWORD n = 0;
  return DeviceIoControl(h, FSCTL_DELETE_REPARSE_POINT, &b, sizeof(b), nullptr,
                         0, &n, nullptr) != 0;
}
void describe(const std::string &label, HANDLE h, bool dir, bool create) {
  auto id = identity(h);
  BY_HANDLE_FILE_INFORMATION i{};
  require(GetFileInformationByHandle(h, &i) != 0, "identity attrs failed");
  std::cout << "IDENTITY " << label << " volume=" << id.volume
            << " file=" << id.file << " canonical=" << narrow(canonical(h))
            << " reparse="
            << !!(i.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
            << " access=" << (dir ? 0x100081 : 0x100083)
            << " share=1 disposition=" << (create ? 2 : 1)
            << " options=" << (dir ? 0x200021 : 0x200060)
            << " attributes=0x1040" << std::endl;
}
Result normal(const std::wstring &selected) {
  Result r;
  {
    auto root = Root::create(selected);
    r = root.create_generation(payload);
    require(r.ready && !r.active, "ready is not active");
  }
  auto i = inspect_generation(r.path);
  require(i.state == State::ready_verified &&
              i.generation.identity == r.identity && !i.generation.active,
          "read-only full verification failed");
  return r;
}
void path_tests() {
  test("unsafe-paths", [] {
    for (const auto &p :
         {L"C:\\", L"relative", L"C:relative", L"\\\\host\\share",
          L"\\\\?\\C:\\test", L"C:\\a\\..\\b", L"C:\\a:stream", L"C:\\NUL.txt",
          L"C:\\test.\\leaf", L"C:\\test \\leaf", L"C:\\test\\Everia\\Versions",
          L"C:\\AppData\\test"})
      refused([&] { Root::create(p); });
    auto p = fresh();
    refused([&] { Root::create(p, Restrictions{{p}}); });
  });
}
void collisions() {
  for (const auto &kind :
       {"file", "directory", "case-file", "symlink", "hardlink"})
    test(std::string("container-collision-") + kind, [&] {
      auto p = fresh(), target = p + L"\\Everia";
      std::string k = kind;
      if (k == "file")
        put(target, "unknown");
      else if (k == "directory")
        mkdir(target);
      else if (k == "case-file")
        put(p + L"\\eVeRiA", "case");
      else if (k == "symlink") {
        guard(target);
        require(CreateSymbolicLinkW(target.c_str(), canary.c_str(),
                                    SYMBOLIC_LINK_FLAG_DIRECTORY | 0x2) != 0,
                "UNPROVEN symlink privilege");
      } else {
        auto f = p + L"\\original";
        put(f, "hardlinked");
        guard(target);
        require(CreateHardLinkW(target.c_str(), f.c_str(), nullptr) != 0,
                "hardlink fixture failed");
      }
      refused([&] { Root::create(p); });
    });
  test("preexisting-generation-collision", [] {
    auto p = fresh();
    Chain c(p);
    auto previous = relative(c.leaf(), L"fixed-generation", true, true);
    refused([&] { relative(c.leaf(), L"FIXED-generation", true, true); });
  });
  for (const auto &kind :
       {"ordinary", "directory", "symlink", "hardlink", "case"})
    test(std::string("payload-collision-") + kind, [&] {
      auto p = fresh();
      auto root = Root::create(p);
      root.set_test_hook([&](const char *phase, const std::wstring &target,
                             void *) {
        if (std::string(phase) != "before-file" ||
            !target.ends_with(L"Everia.exe"))
          return;
        std::string k = kind;
        if (k == "ordinary")
          put(target, "unknown");
        else if (k == "directory")
          mkdir(target);
        else if (k == "case") {
          auto t = target.substr(0, target.size() - 10) + L"eVeRiA.ExE";
          put(t, "unknown-case");
        } else if (k == "symlink") {
          guard(target);
          require(CreateSymbolicLinkW(target.c_str(),
                                      (canary + L"\\outside.txt").c_str(),
                                      0x2) != 0,
                  "UNPROVEN symlink collision");
        } else {
          auto original = p + L"\\unknown-original";
          put(original, "unknown-hardlink");
          guard(target);
          require(CreateHardLinkW(target.c_str(), original.c_str(), nullptr) !=
                      0,
                  "hardlink collision failed");
        }
      });
      refused([&] { root.create_generation(payload); });
    });
}
void deterministic() {
  // Test actual production primitive with an EMPTY retained directory at every
  // level.
  for (unsigned level = 0; level < 4; ++level)
    for (bool directory_child : {false, true})
      test("forced-root-" + std::to_string(level) +
               (directory_child ? "-dir" : "-file"),
           [&] {
             auto p = fresh();
             Chain c(p);
             std::vector<Handle> held;
             for (unsigned n = 0; n < level; ++n) {
               auto part = n == 0   ? L"Everia"
                           : n == 1 ? L"Versions"
                                    : L"generation";
               auto h = relative(held.empty() ? c.leaf() : held.back().value,
                                 part, true, true);
               p += L"\\" + std::wstring(part);
               held.push_back(std::move(h));
             }
             auto parent = held.empty() ? c.leaf() : held.back().value;
             auto id = identity(parent);
             describe("empty-retained-parent", parent, true, level != 0);
             auto a = attacker(p);
             require(a.value != INVALID_HANDLE_VALUE && mount(a.value),
                     "UNPROVEN forced conversion unavailable");
             BY_HANDLE_FILE_INFORMATION info{};
             require(
                 GetFileInformationByHandle(parent, &info) &&
                     !!(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) &&
                     identity(parent) == id,
                 "conversion not observed");
             refused([&] {
               relative(parent, L"payload", directory_child, true,
                        !directory_child);
             });
             require(identity(parent) == id, "root identity changed");
           });
  test("engine-empty-generation-converted", [] {
    auto p = fresh();
    auto root = Root::create(p);
    root.set_test_hook(
        [&](const char *phase, const std::wstring &target, void *) {
          if (std::string(phase) == "generation-created") {
            auto a = attacker(target);
            require(a.value != INVALID_HANDLE_VALUE && mount(a.value),
                    "UNPROVEN engine conversion unavailable");
          }
        });
    refused([&] { root.create_generation(payload); });
  });
  test("intermediate-junction-refusal", [] {
    auto p = fresh();
    mkdir(p + L"\\redirect");
    {
      auto a = attacker(p + L"\\redirect");
      require(a.value != INVALID_HANDLE_VALUE && mount(a.value),
              "junction fixture failed");
    }
    refused([&] { Chain c(p + L"\\redirect"); });
  });
  for (unsigned level = 0; level < 4; ++level)
    test("ancestor-replacement-" + std::to_string(level), [&] {
      auto p = fresh();
      Chain c(p);
      std::vector<Handle> held;
      for (unsigned n = 0; n < level; ++n) {
        auto part = L"level-" + std::to_wstring(n);
        auto h = relative(held.empty() ? c.leaf() : held.back().value, part,
                          true, true);
        p += L"\\" + part;
        held.push_back(std::move(h));
      }
      guard(p);
      guard(p + L"-replaced");
      require(!MoveFileExW(p.c_str(), (p + L"-replaced").c_str(), 0),
              "ancestor replacement succeeded");
      std::cout << "ANCESTOR_RENAME error=" << GetLastError() << std::endl;
    });
}
void races() {
  for (unsigned level = 0; level < 4; ++level)
    test("sustained-root-race-" + std::to_string(level), [&] {
      unsigned attempts = 0, sets = 0, resets = 0, moves = 0, created = 0,
               refusals = 0;
      for (unsigned round = 0; round < 32; ++round) {
        auto p = fresh();
        Chain c(p);
        std::vector<Handle> held;
        for (unsigned n = 0; n < level; ++n) {
          auto part = L"level-" + std::to_wstring(n);
          auto h = relative(held.empty() ? c.leaf() : held.back().value, part,
                            true, true);
          p += L"\\" + part;
          held.push_back(std::move(h));
        }
        auto parent = held.empty() ? c.leaf() : held.back().value;
        auto id = identity(parent);
        auto a = attacker(p);
        require(a.value != INVALID_HANDLE_VALUE, "race adversary open failed");
        guard(p + L"-moved");
        std::atomic<bool> stop = false;
        std::atomic<unsigned> count = 0, s = 0, r = 0, m = 0;
        std::thread t([&] {
          while (!stop || count < 32) {
            if (mount(a.value))
              ++s;
            if (MoveFileExW(p.c_str(), (p + L"-moved").c_str(), 0))
              ++m;
            if (unmount(a.value))
              ++r;
            ++count;
          }
        });
        while (count < 16)
          std::this_thread::yield();
        try {
          auto h = relative(parent, L"payload", false, true, true);
          write_small(h.value, "authorized payload");
          require(upper(canonical(h.value)) == upper(p + L"\\payload"),
                  "race escaped");
          ++created;
        } catch (const Error &) {
          ++refusals;
        }
        stop = true;
        t.join();
        require(identity(parent) == id && m == 0, "race ancestor replacement");
        attempts += count;
        sets += s;
        resets += r;
        moves += m;
        canary_check("root-race-" + std::to_string(level) + "-" +
                     std::to_string(round));
      }
      require(sets > 0 && resets > 0,
              "UNPROVEN no successful reparse adversary");
      std::cout << "RACE level=" << level << " rounds=32 attempts=" << attempts
                << " conversions=" << sets << " resets=" << resets
                << " ancestor_moves=" << moves << " confined=" << created
                << " refused=" << refusals << std::endl;
    });
  test("engine-target-write-replacement-race", [] {
    auto p = fresh();
    auto root = Root::create(p);
    std::atomic<unsigned> attempts = 0, moves = 0, links = 0, writers = 0;
    std::atomic<bool> stop = false;
    std::thread adversary;
    Identity file_id{};
    root.set_test_hook([&](const char *phase, const std::wstring &target,
                           void *handle) {
      if (std::string(phase) == "file-created") {
        guard(target);
        guard(target + L"-moved");
        guard(target + L"-linked");
        file_id = identity(handle);
        stop = false;
        const auto initial = attempts.load();
        adversary = std::thread([&, target] {
          while (!stop || attempts < initial + 256) {
            ++attempts;
            if (MoveFileExW(target.c_str(), (target + L"-moved").c_str(), 0))
              ++moves;
            if (CreateHardLinkW((target + L"-linked").c_str(), target.c_str(),
                                nullptr))
              ++links;
            auto writer = attacker(target, FILE_WRITE_DATA);
            if (writer.value != INVALID_HANDLE_VALUE)
              ++writers;
          }
        });
        while (attempts < initial + 32)
          std::this_thread::yield();
        describe("returned-file-handle", handle, false, true);
      } else if (std::string(phase) == "file-verified") {
        stop = true;
        adversary.join();
        require(identity(handle) == file_id && moves == 0 && links == 0 &&
                    writers == 0,
                "retained target authority violated");
      }
    });
    Result r;
    try {
      r = root.create_generation(payload);
    } catch (...) {
      stop = true;
      if (adversary.joinable())
        adversary.join();
      throw;
    }
    require(r.ready && !r.active, "target race population failed");
    std::cout << "TARGET_RACE concurrent_attempts=" << attempts
              << " moves=" << moves << " links=" << links
              << " writer_opens=" << writers << std::endl;
  });
}
void states() {
  test("complete-two-generations", [] {
    auto p = fresh();
    Result a, b;
    {
      auto root = Root::create(p);
      a = root.create_generation(payload);
      b = root.create_generation(payload);
      require(a.path != b.path && a.identity != b.identity && a.ready &&
                  b.ready && !a.active && !b.active,
              "unique generations failed");
    }
    require(inspect_generation(a.path).state == State::ready_verified &&
                inspect_generation(b.path).state == State::ready_verified,
            "two generation verification failed");
    refused([&] { Root::create(p); });
    std::cout << "GENERATION " << narrow(a.path)
              << " inventory=" << a.inventory_digest << " ready-not-active"
              << std::endl;
  });
  for (const auto &phase : {"generation-created", "creating-flushed",
                            "file-verified", "before-ready"})
    test(std::string("interruption-") + phase, [&] {
      auto p = fresh();
      std::wstring gen;
      {
        auto root = Root::create(p);
        root.set_test_hook(
            [&](const char *s, const std::wstring &path, void *) {
              if (std::string(s) == "generation-created")
                gen = path;
              if (std::string(s) == phase)
                throw Error("injected-interruption");
            });
        refused([&] { root.create_generation(payload); });
      }
      require(!gen.empty(), "no partial generation");
      auto i = inspect_generation(gen);
      require(i.state == State::incomplete && !i.generation.ready &&
                  !i.generation.active,
              "partial misclassified");
    });
  test("unknown-extra-during-population", [] {
    auto p = fresh();
    std::wstring gen;
    {
      auto root = Root::create(p);
      root.set_test_hook(
          [&](const char *phase, const std::wstring &path, void *) {
            if (std::string(phase) == "generation-created")
              gen = path;
            if (std::string(phase) == "before-complete-verification")
              put(path + L"\\user-added.txt", "unknown bytes");
          });
      refused([&] { root.create_generation(payload); });
    }
    require(inspect_generation(gen).state == State::incomplete,
            "extra tree not partial");
    Handle h(CreateFileW((gen + L"\\user-added.txt").c_str(), GENERIC_READ,
                         FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr));
    require(read_small(h.value) == "unknown bytes",
            "unknown neighbor modified");
  });
  test("unknown-extra-after-ready", [] {
    auto r = normal(fresh());
    put(r.path + L"\\user-added.txt", "unknown bytes");
    require(inspect_generation(r.path).state == State::invalid,
            "unknown ready extra accepted");
  });
  for (const auto &kind : {"creating", "ready", "oversized", "payload"})
    test(std::string("tampered-") + kind, [&] {
      auto r = normal(fresh());
      auto path =
          r.path + (std::string(kind) == "payload" ? L"\\resources\\app.asar"
                    : std::string(kind) == "creating"
                        ? L"\\.everia-state\\00-creating.state"
                        : L"\\.everia-state\\01-ready.state");
      if (std::string(kind) == "oversized") {
        guard(path);
        Handle h(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr,
                             TRUNCATE_EXISTING, 0, nullptr));
        require(h.value != INVALID_HANDLE_VALUE, "oversize state open");
        std::string large(5000, 'x');
        DWORD n = 0;
        require(WriteFile(h.value, large.data(), 5000, &n, nullptr) &&
                    n == 5000,
                "oversize fixture failed");
      } else
        replace_bytes(path, "tampered");
      require(inspect_generation(r.path).state == State::invalid,
              "tampered state/payload accepted");
    });
  test("source-hash-mismatch", [] {
    auto src = fresh();
    mkdir(src + L"\\resources");
    mkdir(src + L"\\empty");
    put(src + L"\\Everia.exe", "wrong");
    put(src + L"\\resources\\app.asar", "wrong");
    auto p = fresh();
    auto root = Root::create(p);
    refused([&] { root.create_generation(src); });
  });
  test("state-bound-to-one-root", [] {
    auto a = normal(fresh()), b = normal(fresh());
    std::ifstream f(fs::path(a.path + L"\\.everia-state\\00-creating.state"),
                    std::ios::binary);
    std::string data((std::istreambuf_iterator<char>(f)), {});
    replace_bytes(b.path + L"\\.everia-state\\00-creating.state", data);
    require(inspect_generation(b.path).state == State::invalid,
            "state transplant accepted");
  });
  test("alternate-stream-refusal", [] {
    auto r = normal(fresh());
    auto base = r.path + L"\\resources\\app.asar";
    guard(base);
    Handle h(CreateFileW((base + L":hidden").c_str(),
                         GENERIC_READ | GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                         0, nullptr));
    require(h.value != INVALID_HANDLE_VALUE, "ADS fixture create");
    write_small(h.value, "unexpected stream");
    h = Handle();
    require(inspect_generation(r.path).state == State::invalid, "ADS accepted");
  });
}
void abrupt() {
  test("abrupt-process-interruption", [] {
    auto selected = fresh();
    guard(selected);
    wchar_t executable[1024]{};
    require(GetModuleFileNameW(nullptr, executable, 1024) > 0,
            "test exe path missing");
    std::wstring command = L"\"" + std::wstring(executable) + L"\" \"" +
                           payload + L"\" partial \"" + selected + L"\"";
    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    require(CreateProcessW(executable, command.data(), nullptr, nullptr, FALSE,
                           0, nullptr, nullptr, &si, &pi),
            "partial child launch failed");
    Handle process(pi.hProcess), thread(pi.hThread);
    require(WaitForSingleObject(process.value, 30000) == WAIT_OBJECT_0,
            "partial child timeout");
    DWORD code = 0;
    require(GetExitCodeProcess(process.value, &code) && code == 77,
            "partial child exit mismatch");
    auto versions = selected + L"\\Everia\\Versions";
    unsigned count = 0;
    for (const auto &e : fs::directory_iterator(versions)) {
      auto i = inspect_generation(e.path().wstring());
      require(i.state == State::incomplete && !i.generation.active &&
                  !i.generation.ready,
              "abrupt partial claimed ready");
      ++count;
    }
    require(count == 1, "abrupt partial generation count");
  });
}

void setup() {
  wchar_t temp[1024]{}, out[1024]{};
  require(GetEnvironmentVariableW(L"RUNNER_TEMP", temp, 1024) > 0 &&
              GetEnvironmentVariableW(L"CP2_EVIDENCE", out, 1024) > 0,
          "CI disposable root required");
  auto base = std::wstring(temp);
  absolute(base);
  evidence = out;
  require(below(evidence, base), "evidence outside CI temp");
  require(fs::is_directory(evidence), "evidence folder absent");
  suite = base + L"\\cp2-production-" + std::to_wstring(GetCurrentProcessId()) +
          L"-" + std::to_wstring(GetTickCount64());
  require(CreateDirectoryW(suite.c_str(), nullptr) != 0,
          "exclusive suite create");
  mutation = suite + L"\\mutation";
  canary = suite + L"\\canary";
  require(CreateDirectoryW(mutation.c_str(), nullptr) &&
              CreateDirectoryW(canary.c_str(), nullptr),
          "suite fixtures create");
  require(CreateDirectoryW((canary + L"\\UserFolder").c_str(), nullptr) &&
              CreateDirectoryW((canary + L"\\EmptyFolder").c_str(), nullptr),
          "canary dirs");
  for (const auto &[name, bytes] :
       std::vector<std::pair<std::wstring, std::string>>{
           {L"outside.txt", "external disposable canary"},
           {L"UserFolder\\another.txt", "nested external canary"}}) {
    Handle h(CreateFileW((canary + L"\\" + name).c_str(),
                         GENERIC_READ | GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                         0, nullptr));
    require(h.value != INVALID_HANDLE_VALUE, "canary create");
    write_small(h.value, bytes);
  }
  old = mutation + L"\\old-fixture";
  mkdir(old);
  put(old + L"\\unknown.txt", "untouched old installation fixture");
  old_baseline = snapshot(old);
  save("old-initial.txt", old_baseline);
  baseline = snapshot(canary);
  save("canary-initial.txt", baseline);
  std::cout << "ENVIRONMENT suite=" << narrow(suite)
            << " NTFS-fixed-local x64 inventory=" << inventory_digest() << "\n"
            << baseline << std::endl;
}
} // namespace
int wmain(int argc, wchar_t **argv) {
  try {
    require(argc == 3 || argc == 4,
            "test usage: payload fixture|actual|partial");
    payload = argv[1];
    if (argc == 4) {
      require(std::wstring(argv[2]) == L"partial", "unsupported child mode");
      wchar_t temp[1024]{};
      require(GetEnvironmentVariableW(L"RUNNER_TEMP", temp, 1024) > 0 &&
                  below(argv[3], temp),
              "child outside CI temp");
      auto root = Root::create(argv[3]);
      root.set_test_hook([](const char *phase, const std::wstring &, void *) {
        if (std::string(phase) == "file-verified")
          ExitProcess(77);
      });
      root.create_generation(payload);
      return 2;
    }
    setup();
    if (std::wstring(argv[2]) == L"actual") {
      test("actual-packaged-payload", [] {
        auto r = normal(fresh());
        std::cout << "ACTUAL_PAYLOAD generation=" << narrow(r.path)
                  << " source=" << trusted_inventory().source
                  << " archive=" << trusted_inventory().archive
                  << " files=" << trusted_inventory().files.size()
                  << " directories=" << trusted_inventory().directories.size()
                  << " digest=" << r.inventory_digest << std::endl;
      });
    } else {
      require(std::wstring(argv[2]) == L"fixture", "invalid mode");
      path_tests();
      collisions();
      deterministic();
      races();
      states();
      abrupt();
    }
    canary_check("final");
    std::cout << "PRODUCTION_CREATION_GATE=PASSED tests=" << passed
              << " no-install/no-activation/no-cleanup/no-rename" << std::endl;
    return 0;
  } catch (const std::exception &e) {
    std::cerr << "PRODUCTION_CREATION_GATE=UNPROVEN_OR_FAILED " << e.what()
              << " win32=" << GetLastError() << std::endl;
    return 1;
  }
}
