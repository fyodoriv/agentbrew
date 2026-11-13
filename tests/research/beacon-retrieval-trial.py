import json,os,pathlib,selectors,socket,subprocess,tempfile
root=pathlib.Path(os.environ["BEACON_TRIAL_ROOT"]).resolve()
scratch=pathlib.Path(tempfile.mkdtemp(prefix="benchmark-",dir=root)); project=scratch/"project";project.mkdir()
beacon=root/"beacon"; log=scratch/"synthetic.jsonl"
cases=json.loads((root/"public-benchmark-cases.json").read_text());assert len(cases)==17
log.write_text(json.dumps({"timestamp":"2026-11-12T05:00:00Z","sequence":1,"vendor":"beacon","product":"endpoint-agent","schema_version":"1.0","event":{"kind":"agent_runtime","action":"command.executed","category":"command"},"severity":"info","harness":{"name":"claude_code"},"session":{"id":"synthetic-1","working_directory":str(project)},"tool":{"name":"Shell","command":"synthetic fixture"},"message":"synthetic lesson"})+"\n")
parents=" ".join(f'(literal "{p}")' for p in root.parents)
profile=f'''(version 1)(deny default)(allow process-fork)(allow process-exec (literal "{beacon}") (literal "/bin/cat") (literal "/usr/bin/nc"))(allow sysctl-read)(allow file-read-metadata {parents})(allow file-read* (literal "/") (literal "/private") (literal "/private/tmp") (subpath "{root}") (subpath "/usr") (subpath "/System") (subpath "/private/etc") (subpath "/dev"))(allow file-write* (subpath "{root}") (literal "/dev/null"))(deny network*)'''
env={"HOME":str(scratch),"TMPDIR":str(scratch),"PATH":"/usr/bin:/bin","BEACON_UPDATE_CHECK":"0","BEACON_INTEL":"0"}
def command(*args): return ["/usr/bin/sandbox-exec","-p",profile,str(beacon),*map(str,args)]
def run(*args):
 r=subprocess.run(command(*args),env=env,cwd=project,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=30)
 if r.returncode: raise RuntimeError("beacon command failed: "+" ".join(args[:3]))
 return json.loads(r.stdout)
fd,outside=tempfile.mkstemp(prefix="beacon-public-control-",dir=os.environ["BEACON_OUTSIDE_ROOT"]);os.write(fd,b"synthetic");os.close(fd)
try:
 r=subprocess.run(["/usr/bin/sandbox-exec","-p",profile,"/bin/cat",outside],capture_output=True,env=env,cwd=project);assert r.returncode!=0
 with socket.create_connection(("127.0.0.1",18765),timeout=2):pass
 r=subprocess.run(["/usr/bin/sandbox-exec","-p",profile,"/usr/bin/nc","-z","-w","1","127.0.0.1","18765"],capture_output=True,env=env,cwd=project);assert r.returncode!=0
 print("PASS isolation controls",flush=True)
 base=["--log-path",str(log),"--project",str(project),"--json"]
 for case in cases:
  item=run("memory","candidates","create",*base,"--trace","session:claude_code:synthetic-1","--kind","gotcha","--title","Public benchmark "+case["id"],"--body",case["content"])
  if not isinstance(item.get("id"),str): raise RuntimeError("candidate id missing")
  run("memory","candidates","approve",item["id"],*base,"--reason","public synthetic benchmark")
 print("approved:",len(cases),flush=True)
 p=subprocess.Popen(command("mcp","serve","--log-path",log,"--transport","stdio"),env=env,cwd=project,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ)
 def rpc(i,method,params):
  p.stdin.write(json.dumps({"jsonrpc":"2.0","id":i,"method":method,"params":params})+"\n");p.stdin.flush()
  if not sel.select(30):raise RuntimeError("MCP reply timed out")
  result=json.loads(p.stdout.readline())
  if "error" in result or result.get("result",{}).get("isError"): raise RuntimeError("MCP error")
  return result["result"]
 try:
  rpc(1,"initialize",{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"public-benchmark","version":"1"}})
  p.stdin.write(json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"})+"\n");p.stdin.flush()
  def search_rows(i,arguments):
   out=rpc(i,"tools/call",{"name":"search_memory","arguments":{"project":str(project),"limit":5,**arguments}})
   blocks=[json.loads(x["text"]) for x in out.get("content",[]) if x.get("type")=="text"]
   rows=[row for x in blocks for row in x.get("memories",[])]
   if len(rows)>5:raise RuntimeError("result exceeds limit")
   return rows
  first=next(case for case in cases if case["id"]=="a01")
  control=search_rows(10,{"q":"os.replace"})
  if not any(row.get("body")==first["content"] for row in control):raise RuntimeError("known-word search control failed")
  print("PASS known-word search control",flush=True)
  task_control=search_rows(11,{"task":"os.replace"})
  task_valid=any(row.get("body")==first["content"] for row in task_control)
  print("task known-word control:","PASS" if task_valid else "FAIL",flush=True)
  for mode in ("q","task"):
   if mode=="task" and not task_valid:
    print("task score unverified: known-word control failed",flush=True)
    continue
   hits=0
   for i,case in enumerate(cases):
    rows=search_rows((100 if mode=="q" else 200)+i,{mode:case["query"]})
    rank=next((j+1 for j,row in enumerate(rows) if row.get("body")==case["content"]),None)
    if rank:hits+=1
    print(mode,case["id"],"rank",rank,"entries",len(rows),flush=True)
   print(mode,"recall_at_5:",hits,"/",len(cases),flush=True)
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
  print("PASS synthetic MCP process stopped",flush=True)
finally:os.unlink(outside)
