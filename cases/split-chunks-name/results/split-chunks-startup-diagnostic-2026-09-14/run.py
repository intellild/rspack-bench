from pathlib import Path
import json,os,subprocess,hashlib
root=Path.cwd(); base=root/'results/split-chunks-startup-diagnostic-2026-09-14'
original=json.loads((root/'results/split-chunks-name-2026-09-11T14-29-44-848Z-15/jobs/worktree-a77f-worker-measure-1.json').read_text())
archive=root/'cases/split-chunks-name/results/split-chunks-name-2026-09-11T14-29-44-848Z-15/raw/worktree-a77f-worker-measure-1.json'
expected=json.loads(archive.read_text())['artifacts']
for filename,digest in expected.items():
 assert hashlib.sha256(Path(filename).read_bytes()).hexdigest()==digest, ('Artifact changed',filename)
for iteration in range(3):
 groups=['callback','worker-cold','worker-ready']
 groups=groups[iteration:]+groups[:iteration]
 for group in groups:
  d=base/f'{group}-{iteration+1}'
  if (d/'result.json').exists(): continue
  d.mkdir(); (d/'output').mkdir()
  job=dict(original, mode='callback' if group=='callback' else 'worker', id=d.name, phase='diagnostic', round=iteration+1, output=str(d/'output'),statsFile=str(d/'stats.json'),resultFile=str(d/'result.json'))
  (d/'job.json').write_text(json.dumps(job,indent=2)+'\n')
  env=dict(os.environ,DIAGNOSTIC_WAIT_READY='1' if group=='worker-ready' else '0',DIAGNOSTIC_TRACE=str(d/'trace.json'))
  with (d/'process.log').open('w') as log:
   subprocess.run(['node','--require',str(base/'preload.cjs'),'cases/split-chunks-name/run-build.mjs',str(d/'job.json')],env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=60)
  result=json.loads((d/'result.json').read_text()); assert result['artifacts']==expected
  print(d.name,{k:round(v,2) for k,v in result['timings'].items()},flush=True)
