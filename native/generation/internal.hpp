#pragma once
#include "generation.hpp"
#include <windows.h>
#include <winternl.h>
#include <bcrypt.h>
#include <array>
#include <map>
#include <set>
#include <vector>
namespace everia::generation::detail {
using Bytes = std::vector<unsigned char>;
constexpr ULONG existing = 1, exclusive_create = 2, directory = 1, sync = 0x20, file = 0x40, nofollow = 0x200000;
constexpr ULONG case_insensitive = 0x40, dont_reparse = 0x1000;
void check(bool value, const char* code);
struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  explicit Handle(HANDLE h = INVALID_HANDLE_VALUE) : value(h) {}
  ~Handle(); Handle(Handle&&) noexcept; Handle& operator=(Handle&&) noexcept;
  Handle(const Handle&) = delete; Handle& operator=(const Handle&) = delete;
};
struct File { std::string path; std::uint64_t size; std::string hash; std::string role; };
struct Inventory { unsigned schema; std::string source, build, archive, digest; std::vector<std::string> directories; std::vector<File> files; };
const Inventory& trusted_inventory();
std::string upper(std::string s); std::wstring upper(std::wstring s);
std::string narrow(const std::wstring& s); std::wstring widen(const std::string& s);
void component(const std::wstring& s); std::vector<std::wstring> absolute(const std::wstring& s);
bool overlap(const std::wstring& a, const std::wstring& b);
std::wstring canonical(HANDLE h);
Identity identity(HANDLE h); void regular(HANDLE h, bool is_directory);
Handle relative(HANDLE parent, const std::wstring& name, bool is_directory, bool create, bool writable = false,
                ULONG attrs = case_insensitive | dont_reparse, ULONG leaf_options = nofollow);
struct Chain { std::vector<Handle> held; explicit Chain(const std::wstring& path); HANDLE leaf() const; };
std::string sha256(const std::string& data);
std::string hash_file(HANDLE h, std::uint64_t expected_size);
std::string read_small(HANDLE h);
void write_small(HANDLE h, const std::string& data);
std::map<std::wstring, bool> enumerate(HANDLE h);
void validate_inventory();
void validate_selected(const std::wstring& path, const Restrictions& restrictions);
}
