from pathlib import Path
import json,subprocess,os
root=Path.cwd();base=root/'results/mixed-loader-chain-dispatch-diagnostic-2026-09-15'
previous=root/'results/mixed-loader-chain-2026-09-15T05-46-02-699Z-16'
for mode in ['main','mixed','parallel']:
 d=base/mode;d.mkdir();(d/'stats').mkdir();(d/'audit').mkdir()
 original=json.loads((previous/'jobs'/f'worktree-a77f-{mode}-measure-1.json').read_text())
 job=dict(original,phase='diagnostic',id=mode,round=0,output=str(d/'output'),statsDirectory=str(d/'stats'),auditDirectory=str(d/'audit'),resultFile=str(d/'result.json'))
 (d/'job.json').write_text(json.dumps(job,indent=2)+'\n')
 env=dict(os.environ,MIXED_DISPATCH_REPORT=str(d/'counts.json'))
 with (d/'process.log').open('w') as log:
  subprocess.run(['node','--require',str(base/'preload.cjs'),'cases/mixed-loader-chain/run-build.mjs',str(d/'job.json')],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=90,check=True)
 result=json.loads((d/'result.json').read_text())
 reference=json.loads((previous/'raw'/f'worktree-a77f-{mode}-measure-1.json').read_text())
 assert result['artifacts']==reference['artifacts']
 print(mode,result['status'],(d/'counts.json').read_text(),flush=True)
