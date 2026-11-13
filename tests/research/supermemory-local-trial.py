import json, os, re, socket, subprocess, sys, threading, time, urllib.request, urllib.error
root=os.path.realpath(os.environ['SUPERMEMORY_TRIAL_ROOT'])
port=49412

outside = os.environ['SUPERMEMORY_OUTSIDE_SENTINEL']
try:
    with open(outside, 'r'):
        raise AssertionError('outside scratch file was readable')
except PermissionError:
    pass
with open(os.path.join(root, 'inside-control'), 'w') as handle:
    handle.write('synthetic control')
try:
    os.kill(os.getppid(), 0)
    raise AssertionError('outside parent was signalable')
except PermissionError:
    pass

def connect(port):
    try:
        with socket.create_connection(('127.0.0.1',port),timeout=2): return True
    except OSError: return False

def request(url, body=None, key=None):
    headers={'Content-Type':'application/json'}
    if key: headers['Authorization']='Bearer '+key
    req=urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),headers=headers)
    with urllib.request.urlopen(req,timeout=20) as res: return json.load(res)

def failure_categories(output):
    checks = {
        'permission denied': ('permission denied', 'operation not permitted', 'eacces', 'eperm'),
        'network failure': ('connection refused', 'network is unreachable', 'econnrefused'),
        'database failure': ('database is locked', 'sqlite_error', 'failed to open database'),
        'runtime failure': ('panic:', 'segmentation fault', 'fatal error', 'abort'),
        'embedding failure': ('embedding model', 'embedding provider', 'dimension mismatch'),
        'authentication failure': ('authentication failed', 'unauthorized', 'invalid api key'),
    }
    lowered = output.lower()
    return [label for label, needles in checks.items() if any(needle in lowered for needle in needles)]

def failure_words(output):
    allowed = set('error failed failure cannot unable missing denied invalid unsupported required runtime system module file directory path database storage graph engine model embedding provider server listen address port network socket request response timeout format schema migration disk filesystem access operation connect initialize load start bun node python sqlite ssl tls certificate abort fatal download extract wasm native binary process spawn temporary tmp permission executable unavailable incompatible'.split())
    return sorted(set(re.findall(r'[a-z]+', output.lower())) & allowed)

assert not connect(18765), 'live service socket was reachable'
assert connect(11434), 'local model socket unavailable inside isolation'
try:
    with socket.create_connection(('1.1.1.1',443),timeout=2): raise AssertionError('external network reachable')
except OSError: pass
assert not connect(port), 'trial port already in use'
print('PASS isolation: live service and external network denied; local model reachable',flush=True)
env={'HOME':root,'TMPDIR':root,'PATH':'/usr/bin:/bin','SUPERMEMORY_DATA_DIR':root+'/trial-data','SUPERMEMORY_HOST':'127.0.0.1','SUPERMEMORY_PORT':str(port),'SUPERMEMORY_DISABLE_TELEMETRY':'1','SUPERMEMORY_NO_UPDATE_CHECK':'1','SUPERMEMORY_NO_OPEN':'1','OPENAI_BASE_URL':'http://127.0.0.1:11434/v1','OPENAI_API_KEY':'local-model','OPENAI_MODEL':'qwen3:0.6b','SUPERMEMORY_EMBEDDING_PROVIDER':'openai-compatible','SUPERMEMORY_EMBEDDING_BASE_URL':'http://127.0.0.1:11434/v1','SUPERMEMORY_EMBEDDING_MODEL':'all-minilm:latest','SUPERMEMORY_EMBEDDING_DIMENSIONS':'384'}
proc=subprocess.Popen([root+'/supermemory-server'],env=env,cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
buf=[]
def drain():
    while True:
        c=proc.stdout.read(1)
        if not c: break
        buf.append(c)
drainer=threading.Thread(target=drain,daemon=True)
drainer.start()
try:
    key=None
    for _ in range(180):
        if proc.poll() is not None:
            drainer.join(timeout=3)
            output=b''.join(buf).decode(errors='replace')
            for name in ('error.log', 'data/error.log'):
                try:
                    with open(os.path.join(root, 'trial-data', name), 'r', errors='replace') as error_file:
                        output += error_file.read(1_000_000)
                except OSError:
                    pass
            categories=failure_categories(output)
            raise RuntimeError(f'server exited before readiness: status {proc.returncode}; categories {categories}; words {failure_words(output)}')
        output=b''.join(buf).decode(errors='replace')
        match=re.search(r'\b(sm_[A-Za-z0-9_-]{16,})\b',output)
        if match and connect(port): key=match.group(1); break
        time.sleep(1)
    if not key: raise RuntimeError('server did not expose key and listener within 180 seconds')
    print('PASS server started and trial key captured without output',flush=True)
    base='http://127.0.0.1:'+str(port)+'/ns/synthetic-trial'
    added=request(base+'/document',{'content':'The synthetic project uses the violet otter deployment rule.','dreaming':'instant'},key)
    print('add response status:',added.get('status','unspecified'),flush=True)
    found=False
    for _ in range(60):
        time.sleep(3)
        result=request(base+'/search',{'query':'violet otter deployment rule'},key)
        if 'violet otter' in json.dumps(result).lower(): found=True; break
    if not found: raise RuntimeError('synthetic fact was not retrieved within 180 seconds')
    print('PASS synthetic fact retrieved',flush=True)
finally:
    proc.terminate()
    try: proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill();proc.wait(timeout=10)
    time.sleep(1)
    if connect(port): raise RuntimeError('trial listener remains after cleanup')
    print('PASS trial listener stopped',flush=True)
