// Isolated feasibility surface. Not a publisher or maintenance API for shipping.
#include "internal.hpp"
#include <sddl.h>
#include <shlobj.h>
#include <algorithm>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <sstream>
#include <functional>
using namespace everia::generation;
using namespace everia::generation::detail;
namespace fs = std::filesystem;
constexpr wchar_t descriptor[] = L"O:BAG:BAD:P(A;CI;KA;;;SY)(A;CI;KA;;;BA)(A;CI;KR;;;AU)";
constexpr char payload[] = "Everia 3A.2 non-executable fixture\n";
constexpr char build[] = "checkpoint3a2-fixed-fixture-c79b0d26044f0fd057496f62a6cfe443da5b98ff";
struct Key {
  HKEY h{};
  Key() = default;
  ~Key() { if (h) RegCloseKey(h); }
  Key(const Key&) = delete;
  Key& operator=(const Key&) = delete;
};
struct SD {
  PSECURITY_DESCRIPTOR p{};
  SD() { check(ConvertStringSecurityDescriptorToSecurityDescriptorW(descriptor, SDDL_REVISION_1, &p, nullptr) != 0, "sddl"); }
  ~SD() { LocalFree(p); }
};
std::wstring sid_of(HANDLE token) {
  DWORD n = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &n);
  Bytes b(n);
  check(GetTokenInformation(token, TokenUser, b.data(), n, &n) != 0, "token-user");
  LPWSTR s{};
  check(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(b.data())->User.Sid, &s) != 0, "token-sid");
  std::wstring result(s); LocalFree(s); return result;
}
Handle token() {
  HANDLE h{}; check(OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &h) != 0, "process-token"); return Handle(h);
}
Handle restricted() {
  auto t = token();
  DWORD n=0; GetTokenInformation(t.value, TokenGroups, nullptr, 0, &n);
  Bytes b(n); check(GetTokenInformation(t.value, TokenGroups, b.data(), n, &n) != 0, "token-groups");
  auto* groups = reinterpret_cast<TOKEN_GROUPS*>(b.data());
  std::vector<SID_AND_ATTRIBUTES> disabled;
  for (DWORD i=0; i<groups->GroupCount; ++i) {
    auto &g=groups->Groups[i];
    // Disable every enabled group except groups available to a normal user.
    if ((g.Attributes & SE_GROUP_ENABLED) &&
        !IsWellKnownSid(g.Sid, WinWorldSid) && !IsWellKnownSid(g.Sid, WinAuthenticatedUserSid) &&
        !IsWellKnownSid(g.Sid, WinBuiltinUsersSid) && !IsWellKnownSid(g.Sid, WinInteractiveSid) &&
        !IsWellKnownSid(g.Sid, WinLocalSid) && !(g.Attributes & SE_GROUP_LOGON_ID))
      disabled.push_back({g.Sid, 0});
  }
  HANDLE h{};
  check(CreateRestrictedToken(t.value, DISABLE_MAX_PRIVILEGE, static_cast<DWORD>(disabled.size()), disabled.data(), 0, nullptr, 0, nullptr, &h) != 0, "restricted-token");
  return Handle(h);
}
void protected_key(HKEY h) {
  DWORD n=0; const auto flags=OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION;
  check(RegGetKeySecurity(h, flags, nullptr, &n)==ERROR_INSUFFICIENT_BUFFER && n<16384, "key-security-size");
  Bytes b(n); check(RegGetKeySecurity(h, flags, b.data(), &n)==ERROR_SUCCESS, "key-security");
  SD expected; PSID owner{}, expected_owner{}; BOOL d{};
  check(GetSecurityDescriptorOwner(b.data(), &owner, &d) && GetSecurityDescriptorOwner(expected.p, &expected_owner, &d) && EqualSid(owner, expected_owner), "key-owner-refused");
  SECURITY_DESCRIPTOR_CONTROL control{}; DWORD revision{};
  check(GetSecurityDescriptorControl(b.data(), &control, &revision) && (control&SE_DACL_PROTECTED), "inherited-security-refused");
  PACL actual{}, desired{}; BOOL present{};
  check(GetSecurityDescriptorDacl(b.data(), &present, &actual, &d) && present && actual &&
        GetSecurityDescriptorDacl(expected.p, &present, &desired, &d) && desired, "key-dacl");
  check(actual->AceCount==desired->AceCount, "key-dacl-count");
  for (DWORD i=0; i<actual->AceCount; ++i) {
    void *a{}, *e{}; check(GetAce(actual,i,&a) && GetAce(desired,i,&e), "key-ace");
    const auto size=static_cast<ACE_HEADER*>(a)->AceSize;
    check(size==static_cast<ACE_HEADER*>(e)->AceSize && memcmp(a,e,size)==0, "key-dacl-refused");
  }
  DWORD type=0, size=0;
  check(RegQueryValueExW(h,L"SymbolicLinkValue",nullptr,&type,nullptr,&size)==ERROR_FILE_NOT_FOUND, "registry-link-refused");
}
void open_key(Key& k, const std::wstring &path, REGSAM rights=KEY_READ, HKEY hive=HKEY_LOCAL_MACHINE, REGSAM view=KEY_WOW64_64KEY) {
  check(RegOpenKeyExW(hive,path.c_str(),REG_OPTION_OPEN_LINK,rights|view,&k.h)==ERROR_SUCCESS,"authority-open");
}
void make_key(Key& k, HKEY parent, const std::wstring &name) {
  SD sd; SECURITY_ATTRIBUTES sa{sizeof(sa),sd.p,FALSE}; DWORD disposition{};
  check(RegCreateKeyExW(parent,name.c_str(),0,nullptr,REG_OPTION_NON_VOLATILE,KEY_ALL_ACCESS|KEY_WOW64_64KEY,&sa,&k.h,&disposition)==ERROR_SUCCESS && disposition==REG_CREATED_NEW_KEY,"fresh-authority-required");
  // Explicit protection: creation APIs may otherwise materialize inheritance.
  check(RegSetKeySecurity(k.h,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,sd.p)==ERROR_SUCCESS,"explicit-key-security");
  protected_key(k.h);
}
std::string get_value(HKEY h, const wchar_t* name) {
  DWORD size=0,type=0;
  check(RegQueryValueExW(h,name,nullptr,&type,nullptr,&size)==ERROR_SUCCESS && type==REG_BINARY && size>0 && size<=4096,"record-bounds");
  std::string b(size,'\0');
  check(RegQueryValueExW(h,name,nullptr,&type,reinterpret_cast<BYTE*>(b.data()),&size)==ERROR_SUCCESS && type==REG_BINARY && size==b.size(),"record-read");
  return b;
}
void set_value(HKEY h,const wchar_t* name,const std::string& b) {
  check(b.size()<=8192 && RegSetValueExW(h,name,0,REG_BINARY,reinterpret_cast<const BYTE*>(b.data()),static_cast<DWORD>(b.size()))==ERROR_SUCCESS,"record-write");
  check(RegFlushKey(h)==ERROR_SUCCESS,"authority-flush");
}
std::string id(HANDLE h) { auto x=identity(h); return std::to_string(x.volume)+":"+x.file; }
std::string pack(const std::vector<std::string>& v) {
  std::string b; for (const auto& s:v) { check(s.find('\n')==s.npos,"field-newline"); b+=s+"\n"; }
  return b+sha256(b)+"\n"; // Corruption detection only. ACL supplies publisher boundary.
}
std::vector<std::string> unpack(const std::string& b) {
  std::istringstream s(b); std::vector<std::string> v; std::string line;
  while(std::getline(s,line)) v.push_back(line);
  check(v.size()==17 && b.back()=='\n',"receipt-shape");
  auto digest=v.back(); v.pop_back(); check(pack(v)==b && digest.size()==64,"receipt-checksum"); return v;
}
void validate_namespace(const std::wstring& ns) {
  check(ns.starts_with(L"Software\\Everia-CP3A2-") && ns.size()==54,"test-namespace-only");
  const auto suffix=ns.substr(22); check(suffix.size()==32,"namespace-nonce");
  check(suffix.find_first_not_of(L"0123456789abcdef")==suffix.npos,"namespace-nonce");
}
void pinned_authority(const std::wstring& ns, Key& authority) {
  validate_namespace(ns);
  Key suite; open_key(suite,ns); protected_key(suite.h);
  open_key(authority,ns+L"\\Authority"); protected_key(authority.h);
}
void populate(HANDLE generation) {
  auto file=relative(generation,L"payload.txt",false,true,true);
  auto before=id(file.value); write_small(file.value,payload);
  check(hash_file(file.value,sizeof(payload)-1)==sha256(payload) && id(file.value)==before,"fixture-verify");
}
void publish(const std::wstring& ns, const std::wstring& parent, const std::string& scope, const std::wstring& intended) {
  auto t=token(); check(scope=="machine" || (scope=="user" && sid_of(t.value)==intended),"elevation-sid-refused");
  Key authority; pinned_authority(ns,authority);
  Key writable; open_key(writable,ns+L"\\Authority",KEY_READ|KEY_SET_VALUE);
  Chain chain(parent);
  auto root=relative(chain.leaf(),L"Everia",true,true);
  auto versions=relative(root.value,L"Versions",true,true);
  auto anchor=relative(versions.value,L"anchor",true,true);
  populate(anchor.value);
  auto file=relative(anchor.value,L"payload.txt",false,false);
  const auto anchor_digest=sha256(id(anchor.value)+"\n"+id(file.value));
  std::vector<std::string> fields={"1","1","Everia-CP3A2-test-domain",narrow(ns.substr(22)),scope,narrow(intended),narrow(canonical(root.value)),"1",id(root.value),id(versions.value),id(anchor.value),build,sha256(payload),anchor_digest,"published","inactive"};
  const auto receipt=pack(fields);
  // No existing-path authorizer: every object bound above came from FILE_CREATE.
  set_value(writable.h,L"receipt",receipt);
  check(get_value(writable.h,L"receipt")==receipt,"publication-readback");
  check(id(root.value)==fields[8] && id(versions.value)==fields[9] && id(anchor.value)==fields[10],"publication-identity");
}
void recognize(const std::wstring& ns, bool add, const std::string& expected_scope, const std::wstring& sid) {
  Key authority; pinned_authority(ns,authority);
  auto v=unpack(get_value(authority.h,L"receipt"));
  check(v[0]=="1" && v[1]=="1" && v[2]=="Everia-CP3A2-test-domain" && v[3]==narrow(ns.substr(22)) && v[4]==expected_scope && v[7]=="1" && v[11]==build && v[12]==sha256(payload) && v[14]=="published" && v[15]=="inactive","receipt-contract");
  check(v[4]=="machine" || (v[4]=="user" && v[5]==narrow(sid) && sid_of(token().value)==sid),"receipt-sid");
  Chain root(widen(v[6]));
  auto versions=relative(root.leaf(),L"Versions",true,false);
  auto anchor=relative(versions.value,L"anchor",true,false);
  auto file=relative(anchor.value,L"payload.txt",false,false);
  check(id(root.leaf())==v[8] && id(versions.value)==v[9] && id(anchor.value)==v[10] && sha256(id(anchor.value)+"\n"+id(file.value))==v[13],"receipt-object-identity");
  check(enumerate(anchor.value).size()==1 && hash_file(file.value,sizeof(payload)-1)==v[12],"anchor-verification");
  if(add) { auto next=relative(versions.value,L"second",true,true); populate(next.value); }
}
DWORD child(const std::vector<std::wstring>& args, HANDLE restricted_token=nullptr) {
  wchar_t exe[1024]; check(GetModuleFileNameW(nullptr,exe,1024)>0,"self-path");
  std::wstring cmd=L"\""+std::wstring(exe)+L"\"";
  for(const auto& arg:args) { check(arg.find(L'"')==arg.npos,"argument-quote"); cmd+=L" \""+arg+L"\""; }
  STARTUPINFOW si{}; si.cb=sizeof(si); PROCESS_INFORMATION pi{};
  BOOL ok=restricted_token?CreateProcessAsUserW(restricted_token,nullptr,cmd.data(),nullptr,nullptr,FALSE,0,nullptr,nullptr,&si,&pi):CreateProcessW(nullptr,cmd.data(),nullptr,nullptr,FALSE,0,nullptr,nullptr,&si,&pi);
  if(!ok && restricted_token) ok=CreateProcessWithTokenW(restricted_token,0,nullptr,cmd.data(),0,nullptr,nullptr,&si,&pi);
  check(ok!=0,"fresh-process-unavailable");
  Handle p(pi.hProcess), thread(pi.hThread);
  check(WaitForSingleObject(p.value,30000)==WAIT_OBJECT_0,"child-timeout");
  DWORD code{}; check(GetExitCodeProcess(p.value,&code)!=0,"child-result"); return code;
}
unsigned passed=0,failed=0;
void test(const char* name, const std::function<void()>& f) {
  try { f(); ++passed; std::cout<<"PASS "<<name<<std::endl; }
  catch(const std::exception& e) { ++failed; std::cout<<"FAIL "<<name<<" "<<e.what()<<std::endl; }
}
void refusal(const std::function<void()>& f) { bool refused=false; try{f();}catch(const Error&){refused=true;} check(refused,"unexpected-authority"); }
int wmain(int argc,wchar_t** argv) {
  try {
    check(argc>=2,"arguments"); const std::wstring mode=argv[1];
    if(mode==L"publish") { check(argc==6,"publish-args"); publish(argv[2],argv[3],narrow(argv[4]),argv[5]); return 0; }
    if(mode==L"read") { check(argc==6,"read-args"); recognize(argv[2],std::wstring(argv[3])==L"add",narrow(argv[4]),argv[5]); return 0; }
    check(mode==L"suite" && argc==4,"suite-args");
    const std::wstring ns=argv[2], base=argv[3]; validate_namespace(ns);
    check(fs::path(base).filename().wstring().starts_with(L"cp3a2-"),"disposable-root-required");
    Chain base_chain(base);
    auto own=token(); const auto sid=sid_of(own.value); auto low=restricted();
    std::cout<<"SID "<<narrow(sid)<<"\nTOKEN synthetic restricted primary token; not a genuine standard-account/UAC token\nSDDL "<<narrow(descriptor)<<std::endl;
    Key suite; make_key(suite,HKEY_LOCAL_MACHINE,ns);
    Key authority; make_key(authority,suite.h,L"Authority");
    Key regcanary; make_key(regcanary,suite.h,L"Canary"); set_value(regcanary.h,L"sentinel","registry external canary");
    auto fscanary=relative(base_chain.leaf(),L"ExternalCanary",true,true);
    auto fsfile=relative(fscanary.value,L"sentinel.txt",false,true,true); write_small(fsfile.value,"external filesystem canary");
    const auto fshash=hash_file(fsfile.value,26); const auto fsid=id(fsfile.value);
    std::cout<<"CANARY_BEFORE filesystem "<<fshash<<" registry "<<sha256(get_value(regcanary.h,L"sentinel"))<<std::endl;
    auto selected=relative(base_chain.leaf(),L"selected",true,true);
    const auto selected_path=canonical(selected.value);
    // Do not keep parent handles across process publication: the fresh child pins them itself.
    selected=Handle();
    test("elevated publication in fresh process",[&]{check(child({L"publish",ns,selected_path,L"user",sid})==0,"publisher-exit");});
    test("restart restricted-reader second create-only generation",[&]{check(child({L"read",ns,L"add",L"user",sid},low.value)==0,"reader-exit");});
    test("repeat generation collision refused",[&]{check(child({L"read",ns,L"add",L"user",sid},low.value)!=0,"collision-adopted");});
    const auto original=get_value(authority.h,L"receipt");
    for(const auto right:{KEY_SET_VALUE,KEY_CREATE_SUB_KEY,DELETE,WRITE_DAC,WRITE_OWNER}) {
      test(("restricted deny access "+std::to_string(right)).c_str(),[&]{
        check(ImpersonateLoggedOnUser(low.value)!=0,"impersonation"); Key attack;
        const auto result=RegOpenKeyExW(HKEY_LOCAL_MACHINE,(ns+L"\\Authority").c_str(),REG_OPTION_OPEN_LINK,right|KEY_WOW64_64KEY,&attack.h);
        RevertToSelf(); check(result==ERROR_ACCESS_DENIED,"unauthorized-access");
      });
    }
    test("restricted ancestor delete/recreate refused",[&]{
      check(ImpersonateLoggedOnUser(low.value)!=0,"impersonation"); Key attack;
      const auto result=RegOpenKeyExW(HKEY_LOCAL_MACHINE,ns.c_str(),0,DELETE|KEY_CREATE_SUB_KEY|KEY_WOW64_64KEY,&attack.h);
      RevertToSelf(); check(result==ERROR_ACCESS_DENIED,"ancestor-access");
    });
    test("restricted read available",[&]{check(ImpersonateLoggedOnUser(low.value)!=0,"impersonation"); Key read; const auto r=RegOpenKeyExW(HKEY_LOCAL_MACHINE,(ns+L"\\Authority").c_str(),0,KEY_READ|KEY_WOW64_64KEY,&read.h); RevertToSelf(); check(r==ERROR_SUCCESS,"reader-denied");});
    for(const auto index:{0u,1u,2u,3u,5u,7u,8u,9u,10u,11u,12u,13u,14u}) {
      test(("recomputed checksum substitution field "+std::to_string(index)).c_str(),[&]{auto fields=unpack(original); fields[index]="substitution"; set_value(authority.h,L"receipt",pack(fields)); refusal([&]{recognize(ns,false,"user",sid);}); set_value(authority.h,L"receipt",original);});
    }
    for(const auto& bad:std::vector<std::string>{"", "partial", std::string(5000,'x'), original.substr(0,original.size()-8)}) {
      test("bounded malformed receipt refused",[&]{set_value(authority.h,L"receipt",bad); refusal([&]{recognize(ns,false,"user",sid);}); set_value(authority.h,L"receipt",original);});
    }
    test("machine/user scope conflict refused",[&]{refusal([&]{recognize(ns,false,"machine",sid);});});
    test("missing protected receipt refuses tree reconstruction",[&]{check(RegDeleteValueW(authority.h,L"receipt")==ERROR_SUCCESS,"remove-test-receipt"); refusal([&]{recognize(ns,false,"user",sid);}); set_value(authority.h,L"receipt",original);});
    test("HKCU copied receipt is never authority",[&]{Key lookalike; DWORD disposition{}; check(RegCreateKeyExW(HKEY_CURRENT_USER,(ns+L"\\Authority").c_str(),0,nullptr,0,KEY_ALL_ACCESS,nullptr,&lookalike.h,&disposition)==ERROR_SUCCESS,"hkcu-fixture"); set_value(lookalike.h,L"receipt",original); check(RegDeleteValueW(authority.h,L"receipt")==ERROR_SUCCESS,"remove-test-receipt"); refusal([&]{recognize(ns,false,"user",sid);}); set_value(authority.h,L"receipt",original);});
    test("copied identical payload cannot retarget authority",[&]{
      auto copied=relative(base_chain.leaf(),L"copied",true,true); auto versions=relative(copied.value,L"Versions",true,true); auto anchor=relative(versions.value,L"anchor",true,true); populate(anchor.value);
      auto fields=unpack(original); fields[6]=narrow(canonical(copied.value)); set_value(authority.h,L"receipt",pack(fields)); refusal([&]{recognize(ns,false,"user",sid);}); set_value(authority.h,L"receipt",original);
    });
    test("wrong owner refused",[&]{
      PSECURITY_DESCRIPTOR weak{}; check(ConvertStringSecurityDescriptorToSecurityDescriptorW((L"O:"+sid+L"D:P(A;;KA;;;BA)(A;;KR;;;AU)").c_str(),SDDL_REVISION_1,&weak,nullptr)!=0,"weak-sddl");
      check(RegSetKeySecurity(authority.h,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,weak)==ERROR_SUCCESS,"weak-fixture"); LocalFree(weak);
      refusal([&]{recognize(ns,false,"user",sid);}); SD good; check(RegSetKeySecurity(authority.h,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,good.p)==ERROR_SUCCESS,"restore-fixture");
    });
    test("permissive DACL refused",[&]{PSECURITY_DESCRIPTOR weak{}; check(ConvertStringSecurityDescriptorToSecurityDescriptorW(L"O:BAD:P(A;;KA;;;BA)(A;;KA;;;AU)",SDDL_REVISION_1,&weak,nullptr)!=0,"weak-sddl"); check(RegSetKeySecurity(authority.h,DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,weak)==ERROR_SUCCESS,"weak-fixture"); LocalFree(weak); refusal([&]{recognize(ns,false,"user",sid);}); SD good; check(RegSetKeySecurity(authority.h,DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,good.p)==ERROR_SUCCESS,"restore-fixture");});
    test("receipt and both canaries unchanged",[&]{check(get_value(authority.h,L"receipt")==original && get_value(regcanary.h,L"sentinel")=="registry external canary" && id(fsfile.value)==fsid && hash_file(fsfile.value,26)==fshash && enumerate(fscanary.value).size()==1,"canary-mutated");});
    std::cout<<"CANARY_AFTER filesystem "<<hash_file(fsfile.value,26)<<" registry "<<sha256(get_value(regcanary.h,L"sentinel"))<<std::endl;
    std::cout<<"RESULT "<<passed<<" passed "<<failed<<" failed\nGATE UNPROVEN: synthetic token is not proof of SYSTEM, actual UAC, separate standard/other user; interruption, registry-link and known-folder cases remain outstanding."<<std::endl;
    return failed?1:0;
  } catch(const std::exception& e) { RevertToSelf(); std::cerr<<"REFUSED "<<e.what()<<" win32="<<GetLastError()<<std::endl; return 2; }
}
