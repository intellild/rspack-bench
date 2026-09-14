from pathlib import Path
import json,os,subprocess,hashlib
root=Path.cwd();base=root/'results/split-chunks-startup-prewarm-2026-09-14'
original=json.loads((root/'results/split-chunks-name-2026-09-11T14-29-44-848Z-15/jobs/worktree-a77f-worker-measure-1.json').read_text())
old=json.loads((root/'cases/split-chunks-name/results/split-chunks-name-2026-09-11T14-29-44-848Z-15/raw/worktree-a77f-worker-measure-1.json').read_text())['artifacts']
expected={name:hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in old}
assert all(expected[name]==digest for name,digest in old.items() if name.endswith('.node'))
(base/'artifacts.json').write_text(json.dumps(expected,indent=2)+'\n')
repo='/data00/home/jinzhixin/.codex/worktrees/a77f/rspack'
(base/'worktree.patch').write_bytes(subprocess.check_output(['git','-C',repo,'diff','--binary','HEAD']))
for iteration in range(3):
 groups=['callback','worker'] if iteration%2==0 else ['worker','callback']
 for group in groups:
  d=base/f'{group}-{iteration+1}';d.mkdir();(d/'output').mkdir()
  job=dict(original,mode=group,id=d.name,phase='diagnostic',round=iteration+1,output=str(d/'output'),statsFile=str(d/'stats.json'),resultFile=str(d/'result.json'))
  (d/'job.json').write_text(json.dumps(job,indent=2)+'\n')
  env=dict(os.environ,DIAGNOSTIC_WAIT_READY='0',DIAGNOSTIC_TRACE=str(d/'trace.json'))
  with (d/'process.log').open('w') as log:
   subprocess.run(['node','--require',str(base/'preload.cjs'),'cases/split-chunks-name/run-build.mjs',str(d/'job.json')],env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=60)
  result=json.loads((d/'result.json').read_text());assert result['artifacts']==expected
  trace=json.loads((d/'trace.json').read_text());marks={r['name']:int(r['time']) for r in trace}
  starts=[int(r['time']) for r in trace if r['name']=='worker-constructor-start'];assert len(starts)==31 and max(starts)<marks['compiler-start']
  if group=='worker':
   ready=[int(r['time']) for r in trace if r['name']=='worker-ready-received'];assert len(ready)==31 and max(ready)<marks['make']
   names=[int(r['time']) for r in trace if r['name']=='first-name'];assert len(names)==31 and all(marks['seal']<=t<=marks['afterSeal'] for t in names)
  print(d.name,{k:round(v,2) for k,v in result['timings'].items()},flush=True)
