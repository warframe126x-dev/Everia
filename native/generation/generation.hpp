#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef EVERIA_GENERATION_TESTING
#include <functional>
#endif
namespace everia::generation {
struct Error : std::runtime_error {
  std::string code;
  explicit Error(std::string value);
};
struct Identity {
  std::uint64_t volume;
  std::string file;
  bool operator==(const Identity &) const = default;
};
struct Result {
  std::wstring path;
  std::string generation;
  std::string inventory_digest;
  Identity identity;
  bool ready = false;
  bool active = false;
};
enum class State { incomplete, ready_verified, invalid };
struct Inspection {
  State state = State::invalid;
  std::string reason;
  Result generation;
};
// Exclusions reduce authority only. Mandatory profile/maintenance exclusions
// are always added internally. A caller cannot use this object to expand
// authority.
struct Restrictions {
  std::vector<std::wstring> additional_exclusions;
};
class Root {
  struct Impl;
  std::unique_ptr<Impl> impl_;
  explicit Root(std::unique_ptr<Impl> impl);

public:
  ~Root();
  Root(Root &&) noexcept;
  Root &operator=(Root &&) noexcept;
  Root(const Root &) = delete;
  Root &operator=(const Root &) = delete;
  // Exclusively creates Everia/Versions. Existing containers are NOT adopted.
  static Root create(const std::wstring &selected_location,
                     const Restrictions &restrictions = {});
  // Inventory is compiled into this library, never provided by a runtime
  // caller.
  Result create_generation(const std::wstring &packaged_payload_source);
#ifdef EVERIA_GENERATION_TESTING
  // Absent from production builds and ABI; deterministic adversarial barriers.
  using Hook = std::function<void(const char *, const std::wstring &, void *)>;
  void set_test_hook(Hook hook);
#endif
};
// Read-only inspection re-verifies state and payload against embedded
// inventory. It returns no mutation/cleanup capability and never resumes an
// incomplete tree.
Inspection inspect_generation(const std::wstring &path,
                              const Restrictions &restrictions = {});
std::string inventory_digest();
} // namespace everia::generation
