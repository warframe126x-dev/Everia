// Missing coverage only; reuses the existing publisher and recognizer.
#define wmain original_suite_entry
#include "authority.cpp"
#undef wmain
#include <winioctl.h>
#include <fstream>
#include <userenv.h>

std::wstring env(const wchar_t* name) {
  wchar_t b[2048]{}; auto n=GetEnvironmentVariableW(name,b,2048);
  check(n>0 && n<2048,"completion-environment"); return b;
}
std::string registry_snapshot(HKEY key) {
  DWORD n=0; const auto flags=OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION;
  check(RegGetKeySecurity(key,flags,nullptr,&n)==ERROR_INSUFFICIENT_BUFFER,"snapshot-security-size");
  Bytes sd(n); check(RegGetKeySecurity(key,flags,sd.data(),&n)==ERROR_SUCCESS,"snapshot-security");
  std::string result=sha256(std::string(reinterpret_cast<char*>(sd.data()),n));
  std::map<std::wstring,std::string> items;
  for(DWORD i=0;;++i) {
    wchar_t name[256]{}; DWORD length=256,type=0,size=8192; Bytes data(size);
    auto r=RegEnumValueW(key,i,name,&length,nullptr,&type,data.data(),&size);
    if(r==ERROR_NO_MORE_ITEMS) break;
    check(r==ERROR_SUCCESS,"snapshot-value");
    items[name]="V:"+std::to_string(type)+":"+sha256(std::string(reinterpret_cast<char*>(data.data()),size));
  }
  for(DWORD i=0;;++i) {
    wchar_t name[256]{}; DWORD length=256;
    auto r=RegEnumKeyExW(key,i,name,&length,nullptr,nullptr,nullptr,nullptr);
    if(r==ERROR_NO_MORE_ITEMS) break;
    check(r==ERROR_SUCCESS,"snapshot-subkey");
    Key sub; check(RegOpenKeyExW(key,name,REG_OPTION_OPEN_LINK,KEY_READ|KEY_WOW64_64KEY,&sub.h)==ERROR_SUCCESS,"snapshot-subkey-open");
    items[L"K:"+std::wstring(name)]=registry_snapshot(sub.h);
  }
  for(const auto& item:items) result+="\n"+narrow(item.first)+":"+item.second;
  return result;
}
std::string filesystem_snapshot(const std::wstring& base) {
  std::map<std::string,std::string> entries;
  for(const auto& item:fs::recursive_directory_iterator(base)) {
    const auto attrs=GetFileAttributesW(item.path().c_str());
    check(attrs!=INVALID_FILE_ATTRIBUTES && !(attrs&FILE_ATTRIBUTE_REPARSE_POINT),"snapshot-reparse");
    auto path=item.path().lexically_relative(base).generic_string();
    if(item.is_directory()) entries[path]="D";
    else {
      std::ifstream in(item.path(),std::ios::binary);
      check(in.good(),"snapshot-file-open");
      std::string bytes((std::istreambuf_iterator<char>(in)),std::istreambuf_iterator<char>());
      entries[path]="F:"+std::to_string(bytes.size())+":"+sha256(bytes);
    }
  }
  std::string result;
  for(const auto& item:entries) result+=item.first+":"+item.second+"\n";
  return result;
}
void log_token(const std::wstring& label,bool expected_trusted) {
  auto t=effective_token(); DWORD size=0; TOKEN_ELEVATION e{}; TOKEN_ELEVATION_TYPE type{};
  check(GetTokenInformation(t.value,TokenElevation,&e,sizeof(e),&size)!=0,"context-elevation");
  check(GetTokenInformation(t.value,TokenElevationType,&type,sizeof(type),&size)!=0,"context-elevation-type");
  BYTE admin[SECURITY_MAX_SID_SIZE]; DWORD len=sizeof(admin);
  check(CreateWellKnownSid(WinBuiltinAdministratorsSid,nullptr,admin,&len)!=0,"context-admin-sid");
  DWORD group_bytes=0; GetTokenInformation(t.value,TokenGroups,nullptr,0,&group_bytes);
  Bytes groups(group_bytes); check(GetTokenInformation(t.value,TokenGroups,groups.data(),group_bytes,&group_bytes)!=0,"context-groups");
  auto* list=reinterpret_cast<TOKEN_GROUPS*>(groups.data()); BOOL member=FALSE;
  for(DWORD i=0;i<list->GroupCount;++i) if(EqualSid(list->Groups[i].Sid,admin) &&
      (list->Groups[i].Attributes&SE_GROUP_ENABLED) && !(list->Groups[i].Attributes&SE_GROUP_USE_FOR_DENY_ONLY)) member=TRUE;
  const bool system=sid_of(t.value)==L"S-1-5-18";
  TOKEN_TYPE token_type{}; check(GetTokenInformation(t.value,TokenType,&token_type,sizeof(token_type),&size)!=0,"context-token-type");
  std::cout<<"CONTEXT "<<narrow(label)<<" pid="<<GetCurrentProcessId()<<" token_type="<<token_type<<" SID="<<narrow(sid_of(t.value))
           <<" elevation="<<e.TokenIsElevated<<" type="<<type<<" admin_enabled="<<member<<" system="<<system<<std::endl;
  check((system || member)==expected_trusted,"context-class-mismatch");
  if(label==L"SYSTEM") check(system,"not-system");
  if(label==L"UAC-filtered") check(type==TokenElevationTypeLimited && !e.TokenIsElevated,"not-uac-filtered");
}
void status(const char* operation,LSTATUS result,bool trusted) {
  std::cout<<"ACCESS "<<operation<<" result="<<result<<std::endl;
  check(result==(trusted?ERROR_SUCCESS:ERROR_ACCESS_DENIED),"effective-access-mismatch");
}
void context_probe(const std::wstring& ns,const std::wstring& label,bool trusted) {
  validate_namespace(ns); log_token(label,trusted);
  Key suite; open_key(suite,ns); const auto before=registry_snapshot(suite.h);
  for(const auto rights:std::vector<REGSAM>{DELETE,KEY_CREATE_SUB_KEY,WRITE_DAC,WRITE_OWNER}) {
    Key ancestor_rights;
    status(("actual-suite-ancestor-right-"+std::to_string(rights)).c_str(),
      RegOpenKeyExW(HKEY_LOCAL_MACHINE,ns.c_str(),REG_OPTION_OPEN_LINK,rights|KEY_WOW64_64KEY,&ancestor_rights.h),trusted);
  }
  Key read; open_key(read,ns+L"\\Authority"); protected_key(read.h);
  const auto receipt=get_value(read.h,L"receipt"); std::cout<<"ACCESS legitimate-read result=0\n";
  Key write; const auto r=RegOpenKeyExW(HKEY_LOCAL_MACHINE,(ns+L"\\Authority").c_str(),0,KEY_SET_VALUE|KEY_WOW64_64KEY,&write.h);
  status("write-handle",r,trusted);
  HKEY mutation=trusted?write.h:read.h;
  status("create-record",RegSetValueExW(mutation,L"unauthorized",0,REG_BINARY,reinterpret_cast<const BYTE*>(receipt.data()),static_cast<DWORD>(receipt.size())),trusted);
  status("modify-receipt",RegSetValueExW(mutation,L"receipt",0,REG_BINARY,reinterpret_cast<const BYTE*>(receipt.data()),static_cast<DWORD>(receipt.size())),trusted);
  status("delete-receipt",RegDeleteValueW(mutation,L"receipt"),trusted);
  if(trusted) { set_value(write.h,L"receipt",receipt); check(RegDeleteValueW(write.h,L"unauthorized")==ERROR_SUCCESS,"restore-probe-value"); }
  { Key child_key; DWORD disposition=0;
    status("child-entry",RegCreateKeyExW(read.h,L"unauthorized-child",0,nullptr,0,KEY_READ|KEY_WOW64_64KEY,nullptr,&child_key.h,&disposition),trusted);
  }
  if(trusted) check(RegDeleteKeyExW(read.h,L"unauthorized-child",KEY_WOW64_64KEY,0)==ERROR_SUCCESS,"restore-child");
  for(const auto rights:{WRITE_DAC,WRITE_OWNER}) {
    Key security; auto result=RegOpenKeyExW(HKEY_LOCAL_MACHINE,(ns+L"\\Authority").c_str(),0,rights|KEY_WOW64_64KEY,&security.h);
    status(rights==WRITE_DAC?"security-dacl-handle":"security-owner-handle",result,trusted);
    PSECURITY_DESCRIPTOR weak=nullptr;
    const auto sddl=rights==WRITE_DAC?L"O:BAD:P(A;CI;KA;;;SY)(A;CI;KA;;;BA)(A;CI;KA;;;AU)":(L"O:"+sid_of(effective_token().value)+L"D:P(A;CI;KA;;;SY)(A;CI;KA;;;BA)(A;CI;KR;;;AU)");
    check(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,&weak,nullptr)!=0,"probe-security");
    const auto info=rights==WRITE_DAC?DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION:OWNER_SECURITY_INFORMATION;
    status(rights==WRITE_DAC?"weaken-dacl":"change-owner",RegSetKeySecurity(trusted?security.h:read.h,info,weak),trusted);
    LocalFree(weak);
    if(trusted) { SD good; check(RegSetKeySecurity(security.h,info,good.p)==ERROR_SUCCESS,"restore-probe-security"); }
  }
  status("ancestor-delete",RegDeleteKeyExW(HKEY_LOCAL_MACHINE,(ns+L"\\ProbeAncestor").c_str(),KEY_WOW64_64KEY,0),trusted);
  if(trusted) { Key ancestor; make_key(ancestor,suite.h,L"ProbeAncestor"); set_value(ancestor.h,L"sentinel","ancestor sentinel"); }
  { Key ancestor; DWORD disposition=0;
    const auto result=RegCreateKeyExW(HKEY_LOCAL_MACHINE,(ns+L"\\ProbeAncestor").c_str(),0,nullptr,0,KEY_ALL_ACCESS|KEY_WOW64_64KEY,nullptr,&ancestor.h,&disposition);
    status("ancestor-recreate-open",result,trusted);
  }
  { Key hkcu; check(RegOpenCurrentUser(KEY_ALL_ACCESS,&hkcu.h)==ERROR_SUCCESS,"current-user-hive");
    Key copy; DWORD disposition=0;
    check(RegCreateKeyExW(hkcu.h,(ns+L"\\Authority").c_str(),0,nullptr,0,KEY_ALL_ACCESS,nullptr,&copy.h,&disposition)==ERROR_SUCCESS,"hkcu-context-fixture");
    set_value(copy.h,L"receipt","copied context receipt");
    Key actual; pinned_authority(ns,actual);
    check(get_value(actual.h,L"receipt")==receipt,"hkcu-substituted-authority");
    std::cout<<"ACCESS HKCU-lookalike ignored=1\n";
  }
  check(registry_snapshot(suite.h)==before,"context-registry-preservation");
  std::cout<<"CONTEXT_PRESERVED "<<narrow(label)<<" digest="<<sha256(before)<<std::endl;
}
Handle logon(const wchar_t* user,const wchar_t* password) {
  HANDLE h=nullptr;
  check(LogonUserW(env(user).c_str(),L".",env(password).c_str(),LOGON32_LOGON_INTERACTIVE,LOGON32_PROVIDER_DEFAULT,&h)!=0,"genuine-logon");
  return Handle(h);
}
struct Impersonation {
  explicit Impersonation(HANDLE user) {check(ImpersonateLoggedOnUser(user)!=0,"genuine-token-impersonation");}
  ~Impersonation(){RevertToSelf();}
};
struct Profile {
  HANDLE user;
  PROFILEINFOW info{};
  std::wstring name;
  Profile(HANDLE user_token,const wchar_t* variable):user(user_token),name(env(variable)) {
    auto own=token(TOKEN_ADJUST_PRIVILEGES|TOKEN_QUERY);
    for(const auto privilege:{SE_BACKUP_NAME,SE_RESTORE_NAME,SE_IMPERSONATE_NAME}) {
      TOKEN_PRIVILEGES p{}; p.PrivilegeCount=1;
      check(LookupPrivilegeValueW(nullptr,privilege,&p.Privileges[0].Luid)!=0,"profile-privilege");
      p.Privileges[0].Attributes=SE_PRIVILEGE_ENABLED;
      check(AdjustTokenPrivileges(own.value,FALSE,&p,0,nullptr,nullptr)!=0 && GetLastError()==ERROR_SUCCESS,"profile-privilege-enable");
    }
    info.dwSize=sizeof(info); info.dwFlags=PI_NOUI; info.lpUserName=name.data();
    check(LoadUserProfileW(user,&info)!=0,"genuine-profile-load");
  }
  ~Profile(){if(info.hProfile) UnloadUserProfile(user,info.hProfile);}
};
bool mount_to(const std::wstring& path,const std::wstring& target) {
  Handle h(CreateFileW(path.c_str(),GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
  check(h.value!=INVALID_HANDLE_VALUE,"reparse-fixture-open");
  const auto sub=L"\\??\\"+target;
  struct Mount { DWORD tag; WORD size,reserved,subOffset,subLength,printOffset,printLength; WCHAR data[1]; };
  const auto a=sub.size()*2,b=target.size()*2;
  Bytes bytes(offsetof(Mount,data)+a+2+b+2,0); auto* m=reinterpret_cast<Mount*>(bytes.data());
  m->tag=IO_REPARSE_TAG_MOUNT_POINT; m->size=static_cast<WORD>(bytes.size()-8);
  m->subLength=static_cast<WORD>(a); m->printOffset=static_cast<WORD>(a+2); m->printLength=static_cast<WORD>(b);
  memcpy(m->data,sub.data(),a); memcpy(reinterpret_cast<BYTE*>(m->data)+m->printOffset,target.data(),b);
  DWORD size=0; return DeviceIoControl(h.value,FSCTL_SET_REPARSE_POINT,bytes.data(),static_cast<DWORD>(bytes.size()),nullptr,0,&size,nullptr)!=0;
}
void completion(const std::wstring& ns,const std::wstring& base,bool contexts_only=false) {
  validate_namespace(ns); disposable_path(base+L"\\selected");
  Key suite; make_key(suite,HKEY_LOCAL_MACHINE,ns);
  Key authority; make_key(authority,suite.h,L"Authority");
  Key canary; make_key(canary,suite.h,L"Canary"); set_value(canary.h,L"sentinel","completion registry canary");
  Key ancestor; make_key(ancestor,suite.h,L"ProbeAncestor"); set_value(ancestor.h,L"sentinel","ancestor sentinel");
  // Release before delete/recreate context operations.
  RegCloseKey(ancestor.h); ancestor.h=nullptr;
  fs::create_directory(base+L"\\selected"); publish(ns,base+L"\\selected","machine",L"");
  const auto original=get_value(authority.h,L"receipt");
  const auto root=widen(unpack(original)[6]); const auto versions=root+L"\\Versions"; const auto anchor=versions+L"\\anchor";
  fs::create_directory(versions+L"\\existing");
  {std::ofstream(versions+L"\\existing\\retained.txt",std::ios::binary)<<"existing generation bytes";}
  fs::create_directories(root+L"\\unknown-directory");
  { std::ofstream(base+L"\\external-canary.txt")<<"external sentinel";
    std::ofstream(root+L"\\unknown-directory\\neighbor.txt")<<"unknown neighbor bytes"; }
  const auto before_fs=filesystem_snapshot(base),before_reg=registry_snapshot(suite.h);
  {std::ofstream(env(L"EVIDENCE")+L"\\filesystem-before.txt",std::ios::binary)<<before_fs;
   std::ofstream(env(L"EVIDENCE")+L"\\registry-before.txt",std::ios::binary)<<before_reg;}
  auto preserve=[&] {
    check(filesystem_snapshot(base)==before_fs,"completion-filesystem-preservation");
    check(registry_snapshot(suite.h)==before_reg,"completion-registry-preservation");
    {std::ofstream(env(L"EVIDENCE")+L"\\filesystem-after.txt",std::ios::binary)<<filesystem_snapshot(base);
     std::ofstream(env(L"EVIDENCE")+L"\\registry-after.txt",std::ios::binary)<<registry_snapshot(suite.h);}
    std::cout<<"PRESERVED filesystem="<<sha256(before_fs)<<" registry="<<sha256(before_reg)<<std::endl;
  };
  test("genuine elevated runner administrator access",[&]{context_probe(ns,L"elevated-runner",true);preserve();});
  auto owner=logon(L"CP3_OWNER",L"CP3_OWNER_PASSWORD");
  auto other=logon(L"CP3_OTHER",L"CP3_OTHER_PASSWORD");
  Profile owner_profile(owner.value,L"CP3_OWNER"),other_profile(other.value,L"CP3_OTHER");
  test("genuine standard intended-owner authority access",[&]{{Impersonation context(owner.value);context_probe(ns,L"standard-owner",false);}preserve();});
  test("genuine other standard-user authority access",[&]{{Impersonation context(other.value);context_probe(ns,L"other-standard",false);}preserve();});
  auto admin=logon(L"CP3_ADMIN",L"CP3_ADMIN_PASSWORD");
  Profile admin_profile(admin.value,L"CP3_ADMIN");
  TOKEN_ELEVATION_TYPE type{}; DWORD n=0;
  check(GetTokenInformation(admin.value,TokenElevationType,&type,sizeof(type),&n)!=0,"admin-logon-type");
  TOKEN_LINKED_TOKEN link{};
  if(type==TokenElevationTypeLimited) {
    test("genuine UAC-filtered administrator access",[&]{{Impersonation context(admin.value);context_probe(ns,L"UAC-filtered",false);}preserve();});
    check(GetTokenInformation(admin.value,TokenLinkedToken,&link,sizeof(link),&n)!=0,"admin-linked-token"); Handle full(link.LinkedToken);
    // Request an independently access-checked handle; linked handles can lack launch rights.
    HANDLE usable{};
    check(DuplicateHandle(GetCurrentProcess(),full.value,GetCurrentProcess(),&usable,TOKEN_QUERY|TOKEN_DUPLICATE,FALSE,0)!=0,"linked-handle-rights");
    Handle elevated(usable);
    test("genuine linked elevated administrator access",[&]{{Impersonation context(elevated.value);context_probe(ns,L"linked-elevated",true);}preserve();});
  } else {
    std::cout<<"LIMITATION UAC-filtered unavailable: actual admin interactive logon type="<<type<<"; no synthetic substitute\n";
    test("genuine separate administrator access",[&]{{Impersonation context(admin.value);context_probe(ns,L"separate-admin",true);}preserve();});
  }
  // The trusted fixture binds an existing publisher-created tree to the actual owner SID.
  // This measures read/SID separation only, not a cross-account publisher protocol.
  test("actual owning-user SID read and other-user refusal",[&]{
    auto fields=unpack(original); fields[4]="user"; fields[5]=narrow(sid_of(owner.value)); set_value(authority.h,L"receipt",pack(fields));
    {Impersonation context(owner.value);recognize(ns,false,"user",sid_of(owner.value));}
    {Impersonation context(other.value);refusal([&]{recognize(ns,false,"user",sid_of(owner.value));});}
    set_value(authority.h,L"receipt",original); preserve();
  });
  test("different actual intended SID publisher refuses reassignment",[&]{
    fs::create_directory(base+L"\\wrong-owner");
    check(child({L"publish",ns,base+L"\\wrong-owner",L"user",sid_of(owner.value)})==2,"different-account-contract");
    check(fs::is_empty(base+L"\\wrong-owner"),"owner-refusal-created-tree");
    fs::remove(base+L"\\wrong-owner"); preserve();
  });
  std::cout<<"LIMITATION Actual credential-prompt different-account UAC elevation remains real-PC/manual; SID mismatch above is contract proof only\n";
  if(contexts_only) {
    std::cout<<"CONTEXTS_ONLY_RESULT passed="<<passed<<" failed="<<failed<<"; combined attacks reused from run 37290098193\n";
    check(failed==0,"contexts-failed");return;
  }
  for(const auto& entry:std::vector<std::pair<std::wstring,std::string>>{{root,"container"},{versions,"Versions"},{anchor,"missing-anchor"}}) {
    test(("valid ledger plus replaced "+entry.second).c_str(),[&]{
      const auto moved=entry.first+L"-saved";
      fs::rename(entry.first,moved); fs::create_directory(entry.first);
      const auto attack_state=filesystem_snapshot(base);
      refusal([&]{recognize(ns,true,"machine",L"");});
      check(filesystem_snapshot(base)==attack_state,"refusal-wrote-substitute");
      fs::remove(entry.first); fs::rename(moved,entry.first); preserve();
    });
  }
  test("valid ledger plus entirely missing anchor generation",[&]{
    fs::rename(anchor,anchor+L"-saved");
    const auto attack=filesystem_snapshot(base); refusal([&]{recognize(ns,true,"machine",L"");});
    check(filesystem_snapshot(base)==attack,"missing-anchor-refusal-mutation");
    fs::rename(anchor+L"-saved",anchor); preserve();
  });
  test("ledger-valid modified anchor reopen refuses without further mutation",[&]{
    { std::ofstream(anchor+L"\\payload.txt",std::ios::binary|std::ios::trunc)<<"tampered"; }
    const auto attack=filesystem_snapshot(base); refusal([&]{recognize(ns,true,"machine",L"");});
    check(filesystem_snapshot(base)==attack,"modified-anchor-refusal-mutation");
    { std::ofstream(anchor+L"\\payload.txt",std::ios::binary|std::ios::trunc)<<payload; } preserve();
  });
  test("copied container matching bytes stale receipt retarget refused",[&]{
    fs::copy(root,base+L"\\copy",fs::copy_options::recursive);
    auto fields=unpack(original); fields[6]=narrow(base+L"\\copy"); set_value(authority.h,L"receipt",pack(fields));
    const auto attack=filesystem_snapshot(base); refusal([&]{recognize(ns,true,"machine",L"");});
    check(filesystem_snapshot(base)==attack,"copied-tree-refusal-mutation");
    set_value(authority.h,L"receipt",original); fs::remove_all(base+L"\\copy"); preserve();
  });
  test("conflicting valid-looking receipt during final recognition",[&]{
    reopen_hook=[&](int phase){if(phase==2) set_value(authority.h,L"second-valid-looking",original);};
    refusal([&]{recognize(ns,true,"machine",L"");}); reopen_hook={};
    check(RegDeleteValueW(authority.h,L"second-valid-looking")==ERROR_SUCCESS,"restore-conflict"); preserve();
  });
  test("ledger replaced after read before final recognition",[&]{
    reopen_hook=[&](int phase){if(phase==2){auto fields=unpack(original);fields[1]="2";set_value(authority.h,L"receipt",pack(fields));}};
    refusal([&]{recognize(ns,true,"machine",L"");}); reopen_hook={}; set_value(authority.h,L"receipt",original); preserve();
  });
  test("reparse conversion between ledger read and container reopen",[&]{
    bool converted=false;
    reopen_hook=[&](int phase){if(phase==0){fs::rename(root,root+L"-saved");fs::create_directory(root);converted=mount_to(root,base+L"\\selected");check(converted,"reparse-not-exercised");}};
    refusal([&]{recognize(ns,true,"machine",L"");}); reopen_hook={};
    check(converted && RemoveDirectoryW(root.c_str())!=0,"restore-reparse"); fs::rename(root+L"-saved",root); preserve();
  });
  test("ancestor replacement after root pinned is blocked",[&]{
    bool attempted=false;
    reopen_hook=[&](int phase){if(phase==1){attempted=true;const auto result=MoveFileExW((base+L"\\selected").c_str(),(base+L"\\selected-moved").c_str(),0);const auto error=GetLastError();std::cout<<"ANCESTOR_ATTACK move="<<result<<" error="<<error<<std::endl;check(!result && error==ERROR_SHARING_VIOLATION,"pinned-ancestor-moved");}};
    recognize(ns,false,"machine",L""); reopen_hook={}; check(attempted,"ancestor-not-exercised"); preserve();
  });
  std::cout<<"COMPLETION_RESULT passed="<<passed<<" failed="<<failed<<"\n";
  check(failed==0,"completion-failed");
}
int wmain(int argc,wchar_t** argv) {
  try {
    check(argc>=2,"completion-arguments"); const std::wstring mode=argv[1];
    if(mode==L"publish") {check(argc==6,"publisher-args");publish(argv[2],argv[3],narrow(argv[4]),argv[5]);}
    else if(mode==L"probe") {check(argc==5,"probe-args");context_probe(argv[2],argv[3],std::wstring(argv[4])==L"trusted");}
    else if(mode==L"recognize") {check(argc==5,"recognize-args");recognize(argv[2],false,narrow(argv[3]),argv[4]);}
    else {check((mode==L"completion" || mode==L"contexts") && argc==4,"completion-mode");completion(argv[2],argv[3],mode==L"contexts");}
    return 0;
  } catch(const std::exception& e) {std::cerr<<"COMPLETION_REFUSED "<<e.what()<<" win32="<<GetLastError()<<std::endl;return 2;}
}

