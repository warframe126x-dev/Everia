#include "internal.hpp"
#include <shlobj.h>
#include <algorithm>
#include <cstddef>
#include <cstring>
#include <sstream>
namespace everia::generation {
Error::Error(std::string value) : std::runtime_error(value), code(std::move(value)) {}
namespace detail {
void check(bool value, const char* code) { if (!value) throw Error(code); }
Handle::~Handle() { if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value); }
Handle::Handle(Handle&& h) noexcept : value(h.value) { h.value = INVALID_HANDLE_VALUE; }
Handle& Handle::operator=(Handle&& h) noexcept { if (this != &h) { if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value); value = h.value; h.value = INVALID_HANDLE_VALUE; } return *this; }
std::string upper(std::string s) { for (auto& c : s) if (c >= 'a' && c <= 'z') c -= 'a' - 'A'; return s; }
std::wstring upper(std::wstring s) { for (auto& c : s) if (c >= L'a' && c <= L'z') c -= L'a' - L'A'; return s; }
std::string narrow(const std::wstring& s) { std::string r; for (auto c : s) { check(c >= 32 && c < 127, "unsupported-path-character"); r.push_back(static_cast<char>(c)); } return r; }
std::wstring widen(const std::string& s) { return std::wstring(s.begin(), s.end()); }
void component(const std::wstring& s) {
  check(!s.empty() && s.size() <= 120 && s != L"." && s != L".." && s.back() != L'.' && s.back() != L' ', "ambiguous-component");
  narrow(s); for (auto c : s) check(std::wstring(L"\\/:*?\"<>|").find(c) == std::wstring::npos, "unsafe-component");
  auto stem = upper(s.substr(0, s.find(L'.')));
  check(stem != L"CON" && stem != L"PRN" && stem != L"AUX" && stem != L"NUL" && stem != L"CONIN$" && stem != L"CONOUT$", "reserved-component");
  check(!(stem.size() == 4 && (stem.starts_with(L"COM") || stem.starts_with(L"LPT")) && stem[3] >= L'0' && stem[3] <= L'9'), "reserved-component");
}
std::vector<std::wstring> absolute(const std::wstring& s) {
  check(s.size() > 3 && s.size() <= 700 && s[1] == L':' && s[2] == L'\\' && ((s[0] >= L'A' && s[0] <= L'Z') || (s[0] >= L'a' && s[0] <= L'z')) && s.back() != L'\\', "unsupported-absolute-path");
  std::vector<std::wstring> r; size_t start = 3;
  while (true) { const auto end = s.find(L'\\', start); auto part = s.substr(start, end == std::wstring::npos ? end : end - start); component(part); r.push_back(part); if (end == std::wstring::npos) break; start = end + 1; }
  return r;
}
bool overlap(const std::wstring& a, const std::wstring& b) { const auto x = upper(a), y = upper(b); return x == y || x.starts_with(y + L"\\") || y.starts_with(x + L"\\"); }
std::wstring canonical(HANDLE h) {
  wchar_t buffer[1024]{}; const auto n = GetFinalPathNameByHandleW(h, buffer, 1024, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  check(n > 0 && n < 1024, "canonical-query-failed"); std::wstring p(buffer);
  check(p.starts_with(L"\\\\?\\") && p.size() > 7 && p[5] == L':', "nonlocal-canonical-path"); p.erase(0, 4); return p;
}
Identity identity(HANDLE h) {
  FILE_ID_INFO i{}; check(GetFileInformationByHandleEx(h, FileIdInfo, &i, sizeof(i)) != 0, "identity-query-failed");
  constexpr char chars[] = "0123456789abcdef"; std::string id;
  for (auto c : i.FileId.Identifier) { id += chars[c >> 4]; id += chars[c & 15]; } return {i.VolumeSerialNumber, id};
}
void regular(HANDLE h, bool is_directory) {
  BY_HANDLE_FILE_INFORMATION i{}; check(GetFileInformationByHandle(h, &i) != 0, "attributes-query-failed");
  check(!(i.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && !!(i.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == is_directory, "reparse-or-type-refused");
  if (!is_directory) check(i.nNumberOfLinks == 1, "hard-link-refused");
  if (is_directory) {
    struct CaseInfo { ULONG flags; } ci{};
    check(GetFileInformationByHandleEx(h, static_cast<FILE_INFO_BY_HANDLE_CLASS>(23), &ci, sizeof(ci)) != 0 && ci.flags == 0, "case-sensitive-directory-refused");
  }
}
using CreateFn = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
Handle relative(HANDLE parent, const std::wstring& name, bool is_directory, bool create, bool writable, ULONG attrs, ULONG leaf_options) {
  component(name); UNICODE_STRING text{}; text.Buffer = const_cast<PWSTR>(name.c_str()); text.Length = static_cast<USHORT>(name.size() * 2); text.MaximumLength = text.Length;
  OBJECT_ATTRIBUTES oa{}; oa.Length = sizeof(oa); oa.RootDirectory = parent; oa.ObjectName = &text; oa.Attributes = attrs;
  const auto fn = reinterpret_cast<CreateFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtCreateFile")); check(fn != nullptr, "native-api-unavailable");
  IO_STATUS_BLOCK io{}; HANDLE h = INVALID_HANDLE_VALUE;
  ACCESS_MASK access = FILE_READ_ATTRIBUTES | SYNCHRONIZE | (is_directory ? FILE_LIST_DIRECTORY : FILE_READ_DATA | (writable ? FILE_WRITE_DATA : 0));
  const auto status = fn(&h, access, &oa, &io, nullptr, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, create ? exclusive_create : existing,
    sync | leaf_options | (is_directory ? directory : file), nullptr, 0);
  check(status >= 0, create ? "exclusive-create-refused" : "capability-open-refused"); Handle result(h);
  check(!create || io.Information == 2, "not-exclusively-created"); regular(h, is_directory); return result;
}
Chain::Chain(const std::wstring& path) {
  const auto parts = absolute(path); const auto drive = path.substr(0, 3); wchar_t fs[32]{};
  check(GetDriveTypeW(drive.c_str()) == DRIVE_FIXED && GetVolumeInformationW(drive.c_str(), nullptr, 0, nullptr, nullptr, nullptr, fs, 32) != 0 && std::wstring(fs) == L"NTFS", "unsupported-filesystem");
  Handle h(CreateFileW(drive.c_str(), FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr)); check(h.value != INVALID_HANDLE_VALUE, "root-capability-refused"); regular(h.value, true); held.push_back(std::move(h));
  std::wstring expected = path.substr(0, 2);
  for (const auto& part : parts) { auto next = relative(held.back().value, part, true, false); expected += L"\\" + part; check(upper(canonical(next.value)) == upper(expected), "canonical-alias-refused"); held.push_back(std::move(next)); }
}
HANDLE Chain::leaf() const { return held.back().value; }
struct Hasher {
  BCRYPT_ALG_HANDLE algorithm = nullptr; BCRYPT_HASH_HANDLE value = nullptr;
  Hasher() { check(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0, "hash-provider-failed"); if (BCryptCreateHash(algorithm, &value, nullptr, 0, nullptr, 0, 0) < 0) { BCryptCloseAlgorithmProvider(algorithm, 0); algorithm = nullptr; throw Error("hash-create-failed"); } }
  ~Hasher() { if (value) BCryptDestroyHash(value); if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0); }
  void add(const void* data, ULONG size) { check(BCryptHashData(value, static_cast<PUCHAR>(const_cast<void*>(data)), size, 0) >= 0, "hash-data-failed"); }
  std::string finish() { std::array<unsigned char,32> bytes{}; check(BCryptFinishHash(value, bytes.data(), 32, 0) >= 0, "hash-finish-failed"); std::string out; constexpr char hex[]="0123456789abcdef"; for (auto c : bytes) { out += hex[c>>4]; out += hex[c&15]; } return out; }
};
std::string sha256(const std::string& data) { Hasher h; check(data.size() <= 16*1024*1024, "hash-input-limit"); h.add(data.data(), static_cast<ULONG>(data.size())); return h.finish(); }
void rewind(HANDLE h) { LARGE_INTEGER zero{}; check(SetFilePointerEx(h, zero, nullptr, FILE_BEGIN) != 0, "seek-failed"); }
std::string hash_file(HANDLE h, std::uint64_t size) {
  regular(h, false); const auto id = identity(h); LARGE_INTEGER actual{}; check(GetFileSizeEx(h,&actual) != 0 && actual.QuadPart >= 0 && static_cast<std::uint64_t>(actual.QuadPart) == size && size <= 2ULL*1024*1024*1024, "payload-size-mismatch");
  rewind(h); Hasher hash; Bytes buffer(1024*1024); std::uint64_t total=0;
  while (total < size) { DWORD count=0; const auto wanted=static_cast<DWORD>(std::min<std::uint64_t>(buffer.size(),size-total)); check(ReadFile(h,buffer.data(),wanted,&count,nullptr) != 0 && count == wanted, "payload-read-failed"); hash.add(buffer.data(),count); total+=count; }
  regular(h,false); check(identity(h)==id,"file-identity-changed"); return hash.finish();
}
std::string read_small(HANDLE h) {
  regular(h,false); LARGE_INTEGER size{}; check(GetFileSizeEx(h,&size) != 0 && size.QuadPart >= 0 && size.QuadPart <= 4096, "state-size-invalid"); rewind(h);
  std::string data(static_cast<size_t>(size.QuadPart),'\0'); DWORD count=0; check(ReadFile(h,data.data(),static_cast<DWORD>(data.size()),&count,nullptr) != 0 && count == data.size(), "state-read-failed"); return data;
}
void write_small(HANDLE h, const std::string& data) { check(data.size() <= 4096,"state-size-invalid"); DWORD count=0; check(WriteFile(h,data.data(),static_cast<DWORD>(data.size()),&count,nullptr) != 0 && count==data.size() && FlushFileBuffers(h) != 0,"state-write-failed"); check(read_small(h)==data,"state-readback-failed"); }
std::map<std::wstring,bool> enumerate(HANDLE h) {
  regular(h,true); std::map<std::wstring,bool> output; alignas(8) std::array<unsigned char,65536> buffer{}; bool restart=true;
  for (;;) {
    if (!GetFileInformationByHandleEx(h,restart ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo,buffer.data(),static_cast<DWORD>(buffer.size()))) { check(GetLastError()==ERROR_NO_MORE_FILES,"directory-enumeration-failed"); break; }
    restart=false; size_t offset=0;
    for (;;) {
      check(offset+offsetof(FILE_ID_BOTH_DIR_INFO,FileName)<=buffer.size(),"directory-record-invalid"); const auto* i=reinterpret_cast<const FILE_ID_BOTH_DIR_INFO*>(buffer.data()+offset);
      check(i->FileNameLength%2==0 && offset+offsetof(FILE_ID_BOTH_DIR_INFO,FileName)+i->FileNameLength<=buffer.size(),"directory-name-invalid");
      std::wstring name(i->FileName,i->FileNameLength/2);
      if (name!=L"." && name!=L"..") { component(name); check(!(i->FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT),"directory-reparse-entry"); check(output.emplace(upper(name),!!(i->FileAttributes & FILE_ATTRIBUTE_DIRECTORY)).second,"case-collision-entry"); check(output.size()<=15000,"enumeration-limit"); }
      if (!i->NextEntryOffset) break; check(i->NextEntryOffset%8==0 && i->NextEntryOffset>=offsetof(FILE_ID_BOTH_DIR_INFO,FileName)+i->FileNameLength && offset+i->NextEntryOffset<buffer.size(),"directory-offset-invalid"); offset+=i->NextEntryOffset;
    }
  }
  return output;
}
void no_extra_streams(HANDLE h) {
  alignas(8) std::array<unsigned char,65536> buffer{};
  if(!GetFileInformationByHandleEx(h,FileStreamInfo,buffer.data(),static_cast<DWORD>(buffer.size()))) {
    check(GetLastError()==ERROR_HANDLE_EOF,"stream-enumeration-failed");return;
  }
  size_t offset=0;
  for(;;){
    check(offset+offsetof(FILE_STREAM_INFO,StreamName)<=buffer.size(),"stream-record-invalid");
    const auto* i=reinterpret_cast<const FILE_STREAM_INFO*>(buffer.data()+offset);
    check(i->StreamNameLength%2==0 && offset+offsetof(FILE_STREAM_INFO,StreamName)+i->StreamNameLength<=buffer.size(),"stream-name-invalid");
    check(std::wstring(i->StreamName,i->StreamNameLength/2)==L"::$DATA","unexpected-alternate-stream");
    if(!i->NextEntryOffset)break;
    check(i->NextEntryOffset%8==0 && i->NextEntryOffset>=offsetof(FILE_STREAM_INFO,StreamName)+i->StreamNameLength && offset+i->NextEntryOffset<buffer.size(),"stream-offset-invalid");offset+=i->NextEntryOffset;
  }
}
bool lower_hex(const std::string& s,size_t n) { return s.size()==n && std::all_of(s.begin(),s.end(),[](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');}); }
std::vector<std::string> relative_parts(const std::string& s) {
  check(!s.empty() && s.size()<=240,"inventory-path-invalid"); std::vector<std::string> result; size_t start=0;
  for (;;) { auto end=s.find('/',start); auto p=s.substr(start,end==std::string::npos?end:end-start); component(widen(p)); check(upper(p)!=".EVERIA-STATE","reserved-inventory-path"); result.push_back(p); if(end==std::string::npos)break; start=end+1; } return result;
}
void validate_inventory() {
  const auto& i=trusted_inventory(); check(i.schema==1 && lower_hex(i.source,40) && lower_hex(i.archive,64) && lower_hex(i.digest,64) && !i.build.empty() && i.build.size()<=64,"inventory-provenance-invalid");
  check(std::all_of(i.build.begin(),i.build.end(),[](char c){return (c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-';}),"build-id-invalid");
  check(!i.files.empty() && i.files.size()<=10000 && i.directories.size()<=4096,"inventory-count-invalid"); std::set<std::string> paths, dirs; std::string previous;
  std::string body="EVERIA-PAYLOAD\t1\nsource\t"+i.source+"\nbuild\t"+i.build+"\narchive\t"+i.archive+"\narch\tx64\n";
  for (const auto& d:i.directories) { relative_parts(d); check(previous.empty()||previous<d,"inventory-unsorted"); previous=d; check(paths.insert(upper(d)).second,"inventory-case-collision"); dirs.insert(d); body+="D\t"+d+"\n"; }
  previous.clear(); std::uint64_t total=0;
  auto parent_check=[&](const std::string& p){auto at=p.rfind('/'); if(at!=std::string::npos)check(dirs.contains(p.substr(0,at)),"inventory-parent-missing");};
  for (const auto& d:i.directories) parent_check(d);
  for(const auto& f:i.files) { relative_parts(f.path); parent_check(f.path); check(previous.empty()||previous<f.path,"inventory-unsorted");previous=f.path;check(paths.insert(upper(f.path)).second,"inventory-case-collision"); check(f.size<=2ULL*1024*1024*1024 && lower_hex(f.hash,64),"inventory-file-invalid"); total+=f.size; check(total<=8ULL*1024*1024*1024,"inventory-byte-limit");check(f.role=="application-entry"||f.role=="application-bundle"||f.role=="runtime-binary"||f.role=="runtime-data","inventory-role-invalid");body+="F\t"+f.path+"\t"+std::to_string(f.size)+"\t"+f.hash+"\t"+f.role+"\n"; }
  check(sha256(body)==i.digest,"inventory-digest-invalid"); check(paths.contains("EVERIA.EXE")&&paths.contains("RESOURCES/APP.ASAR"),"not-everia-payload");
}
std::wstring known(REFKNOWNFOLDERID id) { PWSTR value=nullptr; check(SHGetKnownFolderPath(id,KF_FLAG_DEFAULT,nullptr,&value)==S_OK,"known-folder-unavailable");std::wstring p(value);CoTaskMemFree(value);return p; }
void validate_selected(const std::wstring& path,const Restrictions& restrictions) {
  const auto parts=absolute(path); check(path.size()<=400,"selected-path-limit");
  for(const auto& p:parts) { const auto u=upper(p);check(u!=L"EVERIA"&&u!=L"VERSIONS"&&u!=L"APPDATA"&&u!=L".EVERIA-STATE", "unsafe-root-nesting"); }
  auto excluded=restrictions.additional_exclusions;
  excluded.push_back(known(FOLDERID_RoamingAppData)+L"\\Everia"); excluded.push_back(known(FOLDERID_LocalAppData)+L"\\EveriaMaintenance");
  for(const auto& e:excluded){absolute(e);check(!overlap(path,e),"protected-storage-overlap");}
}
}
using namespace detail;
namespace {
struct Tree {
  std::wstring path; std::map<std::string,Handle> dirs, files; std::map<std::string,Identity> ids;
  void add_dir(const std::string& name,Handle h) { ids[name]=identity(h.value); dirs.emplace(name,std::move(h)); }
  void add_file(const std::string& name,Handle h) { ids[name]=identity(h.value);files.emplace(name,std::move(h)); }
  HANDLE dir(const std::string& name) const { return dirs.at(name).value; }
};
std::pair<std::string,std::wstring> split(const std::string& path) {const auto at=path.rfind('/');return {at==std::string::npos?"":path.substr(0,at),widen(at==std::string::npos?path:path.substr(at+1))};}
std::wstring full(const std::wstring& root,const std::string& path){auto p=widen(path);std::replace(p.begin(),p.end(),L'/',L'\\');return root+L"\\"+p;}
void confirm(HANDLE h,const std::wstring& expected) {check(upper(canonical(h))==upper(expected),"created-object-escaped-root");}
std::string state_record(const Tree& tree,const std::string& phase) {
  const auto& inv=trusted_inventory(); const auto id=identity(tree.dir(""));
  const auto name=narrow(tree.path.substr(tree.path.rfind(L'\\')+1));
  std::string body="EVERIA-GENERATION\t1\nphase\t"+phase+"\nactive\tfalse\ngeneration\t"+name+"\nsource\t"+inv.source+"\nbuild\t"+inv.build+"\ninventory\t"+inv.digest+"\nroot\t"+narrow(tree.path)+"\nvolume\t"+std::to_string(id.volume)+"\nfile-id\t"+id.file+"\n";
  return body+"digest\t"+sha256(body)+"\n";
}
void verify_tree(Tree& tree,bool ready) {
  std::map<std::string,std::map<std::wstring,bool>> expected;for(const auto& [p,h]:tree.dirs){(void)h;expected[p];}
  for(const auto& [p,h]:tree.dirs) if(!p.empty()){(void)h;const auto [parent,leaf]=split(p);expected[parent][upper(leaf)]=true;}
  for(const auto& [p,h]:tree.files){(void)h;const auto [parent,leaf]=split(p);expected[parent][upper(leaf)]=false;}
  for(const auto& [p,h]:tree.dirs) {regular(h.value,true);no_extra_streams(h.value);check(identity(h.value)==tree.ids.at(p),"directory-identity-changed");confirm(h.value,p.empty()?tree.path:full(tree.path,p));check(enumerate(h.value)==expected[p],"unknown-or-missing-entry");}
  for(const auto& [p,h]:tree.files){(void)p;no_extra_streams(h.value);}
  for(const auto& f:trusted_inventory().files){const auto h=tree.files.at(f.path).value;check(identity(h)==tree.ids.at(f.path),"file-identity-changed");confirm(h,full(tree.path,f.path));check(hash_file(h,f.size)==f.hash,"payload-hash-mismatch");}
  check(read_small(tree.files.at(".everia-state/00-creating.state").value)==state_record(tree,"creating"),"state-invalid");
  if(ready)check(read_small(tree.files.at(".everia-state/01-ready.state").value)==state_record(tree,"ready-verified"),"state-invalid");
}
std::string generation_name() {
  std::array<unsigned char,16> bytes{};check(BCryptGenRandom(nullptr,bytes.data(),16,BCRYPT_USE_SYSTEM_PREFERRED_RNG)>=0,"random-generation-failed");std::string token;constexpr char hex[]="0123456789abcdef";for(auto c:bytes){token+=hex[c>>4];token+=hex[c&15];}return trusted_inventory().source.substr(0,12)+"-"+token;
}
void validate_generation_name(const std::string& name) {check(name.size()==45&&name.substr(0,12)==trusted_inventory().source.substr(0,12)&&name[12]=='-'&&lower_hex(name.substr(13),32),"generation-name-invalid");}
void copy(HANDLE source,HANDLE destination,const File& f) {
  no_extra_streams(source);check(hash_file(source,f.size)==f.hash,"source-hash-mismatch");rewind(source);const auto id=identity(destination);Bytes buffer(1024*1024);std::uint64_t total=0;
  while(total<f.size){DWORD n=0,w=0;const auto need=static_cast<DWORD>(std::min<std::uint64_t>(buffer.size(),f.size-total));check(ReadFile(source,buffer.data(),need,&n,nullptr)!=0&&n==need,"source-read-failed");check(WriteFile(destination,buffer.data(),n,&w,nullptr)!=0&&w==n,"payload-write-failed");total+=n;}
  check(FlushFileBuffers(destination)!=0,"payload-flush-failed");check(identity(destination)==id&&hash_file(destination,f.size)==f.hash,"payload-readback-failed");
}
}
struct Root::Impl {
  std::wstring selected,path;Restrictions restrictions;Chain ancestors;Handle container,versions;
#ifdef EVERIA_GENERATION_TESTING
  Root::Hook hook;
  void event(const char* phase,const std::wstring& p,HANDLE h){if(hook)hook(phase,p,h);}
#else
  void event(const char*,const std::wstring&,HANDLE){}
#endif
  Impl(const std::wstring& p,const Restrictions& r):selected(p),path(p+L"\\Everia\\Versions"),restrictions(r),ancestors(p) {
    // No fallback or adoption. Failure can leave newly created empty components.
    container=relative(ancestors.leaf(),L"Everia",true,true);confirm(container.value,p+L"\\Everia");
    versions=relative(container.value,L"Versions",true,true);confirm(versions.value,path);
  }
};
Root::Root(std::unique_ptr<Impl> p):impl_(std::move(p)){} Root::~Root()=default;Root::Root(Root&&) noexcept=default;Root& Root::operator=(Root&&) noexcept=default;
Root Root::create(const std::wstring& selected,const Restrictions& restrictions){validate_inventory();validate_selected(selected,restrictions);return Root(std::make_unique<Impl>(selected,restrictions));}
#ifdef EVERIA_GENERATION_TESTING
void Root::set_test_hook(Hook h){impl_->hook=std::move(h);}
#endif
Result Root::create_generation(const std::wstring& source_path) {
  check(impl_!=nullptr,"root-capability-unavailable");absolute(source_path);check(!overlap(source_path,impl_->selected),"source-destination-overlap");Chain source(source_path);
  regular(impl_->versions.value,true);const auto name=generation_name();impl_->event("before-generation",impl_->path,impl_->versions.value);
  Tree tree;tree.path=impl_->path+L"\\"+widen(name);auto gen=relative(impl_->versions.value,widen(name),true,true);confirm(gen.value,tree.path);tree.add_dir("",std::move(gen));
  impl_->event("generation-created",tree.path,tree.dir(""));
  tree.add_dir(".everia-state",relative(tree.dir(""),L".everia-state",true,true));
  tree.add_file(".everia-state/00-creating.state",relative(tree.dir(".everia-state"),L"00-creating.state",false,true,true));write_small(tree.files.at(".everia-state/00-creating.state").value,state_record(tree,"creating"));
  impl_->event("creating-flushed",tree.path,tree.dir(""));
  for(const auto& d:trusted_inventory().directories){const auto [parent,leaf]=split(d);impl_->event("before-directory",full(tree.path,d),tree.dir(parent));auto h=relative(tree.dir(parent),leaf,true,true);confirm(h.value,full(tree.path,d));tree.add_dir(d,std::move(h));}
  // Source ancestors and every copied target remain held through readiness.
  std::map<std::string,Handle> source_dirs;
  for(const auto& d:trusted_inventory().directories){const auto [parent,leaf]=split(d);source_dirs.emplace(d,relative(parent.empty()?source.leaf():source_dirs.at(parent).value,leaf,true,false));}
  for(const auto& f:trusted_inventory().files){const auto [parent,leaf]=split(f.path);auto input=relative(parent.empty()?source.leaf():source_dirs.at(parent).value,leaf,false,false);impl_->event("before-file",full(tree.path,f.path),tree.dir(parent));auto output=relative(tree.dir(parent),leaf,false,true,true);confirm(output.value,full(tree.path,f.path));tree.add_file(f.path,std::move(output));impl_->event("file-created",full(tree.path,f.path),tree.files.at(f.path).value);copy(input.value,tree.files.at(f.path).value,f);impl_->event("file-verified",full(tree.path,f.path),tree.files.at(f.path).value);}
  impl_->event("before-complete-verification",tree.path,tree.dir(""));verify_tree(tree,false);
  impl_->event("before-ready",tree.path,tree.dir(""));
  tree.add_file(".everia-state/01-ready.state",relative(tree.dir(".everia-state"),L"01-ready.state",false,true,true));write_small(tree.files.at(".everia-state/01-ready.state").value,state_record(tree,"ready-verified"));verify_tree(tree,true);
  impl_->event("ready-verified",tree.path,tree.dir(""));return {tree.path,name,trusted_inventory().digest,identity(tree.dir("")),true,false};
}
Inspection inspect_generation(const std::wstring& path,const Restrictions& restrictions) {
  try{
    validate_inventory();auto parts=absolute(path);check(parts.size()>=4,"generation-layout-invalid");const auto name=narrow(parts.back());validate_generation_name(name);check(parts[parts.size()-2]==L"Versions"&&parts[parts.size()-3]==L"Everia","generation-layout-invalid");
    const auto suffix=L"\\Everia\\Versions\\"+widen(name);check(path.ends_with(suffix),"generation-layout-invalid");validate_selected(path.substr(0,path.size()-suffix.size()),restrictions);Chain chain(path);
    Tree tree;tree.path=path;auto gen=relative(chain.held[chain.held.size()-2].value,widen(name),true,false);tree.add_dir("",std::move(gen));
    Result result{path,name,trusted_inventory().digest,identity(tree.dir("")),false,false};
    const auto entries=enumerate(tree.dir(""));if(!entries.contains(L".EVERIA-STATE"))return {State::incomplete,"creating-state-missing",result};
    tree.add_dir(".everia-state",relative(tree.dir(""),L".everia-state",true,false));auto state_entries=enumerate(tree.dir(".everia-state"));
    check(state_entries.contains(L"00-CREATING.STATE"),"creating-state-missing");tree.add_file(".everia-state/00-creating.state",relative(tree.dir(".everia-state"),L"00-creating.state",false,false));
    check(read_small(tree.files.at(".everia-state/00-creating.state").value)==state_record(tree,"creating"),"state-invalid");
    if(!state_entries.contains(L"01-READY.STATE")){check(state_entries.size()==1,"unknown-state-entry");return {State::incomplete,"population-not-ready",result};}
    tree.add_file(".everia-state/01-ready.state",relative(tree.dir(".everia-state"),L"01-ready.state",false,false));check(read_small(tree.files.at(".everia-state/01-ready.state").value)==state_record(tree,"ready-verified"),"state-invalid");
    for(const auto& d:trusted_inventory().directories){const auto [parent,leaf]=split(d);tree.add_dir(d,relative(tree.dir(parent),leaf,true,false));}
    for(const auto& f:trusted_inventory().files){const auto [parent,leaf]=split(f.path);tree.add_file(f.path,relative(tree.dir(parent),leaf,false,false));}
    verify_tree(tree,true);result.ready=true;return {State::ready_verified,"fully-reverified-not-active",result};
  }catch(const Error& e){return {State::invalid,e.code,{}};}catch(const std::exception&){return {State::invalid,"inspection-failed",{}};}
}
std::string inventory_digest(){validate_inventory();return trusted_inventory().digest;}
}
