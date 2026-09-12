"""One-time naming/documentation reconciliation for the reviewed source tree.
No user data, installed databases, dependency versions, or runtime permissions are changed.
"""
from pathlib import Path
import subprocess, re, json
root = Path.cwd()
tracked = [p for p in subprocess.check_output(['git','ls-files','-z']).decode().split('\0') if p]
assert (root/'packages/protocol/src/phase2-interaction.ts').is_file(), 'Unexpected source baseline'
replacements = {
 'experiments/phase5-app-server': 'experiments/agent-execution',
 'phase5-execution': 'task-execution',
 'phase2-grounding': 'target-grounding',
 'phase2-interaction': 'verified-interaction',
 'task-engine-static-gates': 'task-engine-architecture',
 'task-ledger-sqlite.gate0': 'task-ledger-sqlite-integrity',
 'v1.e2e.test': 'session-lifecycle.e2e.test',
 'electron-sqlite-gate0': 'electron-sqlite-integrity',
 'p59-native-surface': 'native-task-surface',
 'run-native-lifecycle-l0': 'run-lifecycle-contract',
 'native-lifecycle-l0': 'lifecycle-contract',
 'run-production-recovery-l2': 'run-process-recovery',
 'p5.9-production-recovery-l2': 'process-recovery',
 'p5.9-live-acceptance': 'browser-acceptance',
 'p5.9-native-lifecycle-l0': 'lifecycle-contract',
 'p5.6-p5.7-product-surface': 'product-surface',
 'gate4-cli': 'evidence-acquisition-cli',
 'gate5-cli': 'strategy-comparison-cli',
 'gate5-strategies': 'classification-strategies',
 'gate6-cli': 'heldout-validation-cli',
 'gate6-heldout': 'heldout-cases',
 'gate6-validation': 'observation-stability',
 'gate6-candidate': 'structural-semantic-classifier',
 'gate6-remediation-cli': 'structural-semantic-validation-cli',
 'gate6-challenge.test': 'heldout-challenge.test',
 'f1-risk-model': 'risk-model',
 'f1-gate3-browser-inspect': 'browser-inspect-baseline',
 'f1-gate3-pure-classifier': 'classifier-baseline',
 'f1-gate4-results': 'evidence-acquisition-results',
 'f1-gate5-strategy-results': 'strategy-comparison-results',
 'phase5:p50:fixtures': 'agent:fixtures',
 'phase5:p50:schema': 'agent:schema',
 'phase5:p50:live': 'agent:live',
 'phase5:p59:l0': 'test:recovery:contract',
 'phase5:p59:l2': 'test:recovery:processes',
 'phase5:attachments': 'test:attachments',
 'phase5:stabilization:source-product-live': 'test:browser:live-stability',
 'perception:research:gate4': 'perception:research:evidence',
 'perception:research:gate5': 'perception:research:strategies',
 'perception:validation:gate6-remediation': 'perception:validation:structural-semantics',
 'perception:validation:gate6': 'perception:validation:heldout',
 'browser:capability-waves': 'browser:capabilities:integration',
 '001_gate0': '001_task_integrity_schema',
 'rove-ledger-gate0-': 'rove-ledger-integrity-',
}
variants = {2:'surface-grounding',3:'workflow-scope',4:'surface-ownership',5:'title-role',6:'alert-precedence',7:'document-frame'}
for n,name in variants.items():
 replacements[f'gate6-candidate-v{n}']=f'{name}-classifier'
 replacements[f'gate6-semantics-v{n}']=f'{name}-semantics'
 replacements[f'gate6-s4r{n}-cli']=f'{name}-validation-cli'
 replacements[f'perception:validation:gate6-s4r{n}']=f'perception:validation:{name}'
for old,name in {'b':'presentation-boundaries','c':'hidden-and-optional-surfaces','d':'nested-scope-boundaries','e':'surface-placement-boundaries','f':'document-title-boundaries','g':'evidence-precedence-boundaries','h':'frame-ownership-boundaries'}.items():
 replacements[f'gate6-challenge-{old}']=name
 replacements[f'perception:validation:gate6-challenge-{old}']=f'perception:validation:{name}'
replacements['experiments/agent-execution/l2/']='experiments/agent-execution/recovery-harness/'
replacements['experiments/agent-execution/l2']='experiments/agent-execution/recovery-harness'
replacements['./l2/']='./recovery-harness/'
fixtures = {
 'docs/capabilities/web-capability-atlas.json':'tests/fixtures/capabilities/web-capability-atlas.json',
 'docs/hardening/perception/f1-risk-model.json':'tests/fixtures/perception/risk-model.json',
 'docs/hardening/perception/baselines/f1-gate3-browser-inspect.json':'tests/fixtures/perception/browser-inspect-baseline.json',
 'docs/hardening/perception/baselines/f1-gate3-pure-classifier.json':'tests/fixtures/perception/classifier-baseline.json',
 'docs/hardening/perception/experiments/f1-gate4-results.json':'tests/fixtures/perception/evidence-acquisition-results.json',
 'docs/hardening/perception/experiments/f1-gate5-strategy-results.json':'tests/fixtures/perception/strategy-comparison-results.json',
 'docs/hardening/runtime/manual-fixtures/manual-download-test.html':'tests/fixtures/browser/download.html',
 'docs/hardening/runtime/manual-fixtures/manual-iframe-test.html':'tests/fixtures/browser/iframe.html',
 'artifacts/phase5-gmail-calendar-live-20260909-181822.json':'tests/fixtures/agent-execution/gmail-calendar-outcome.json',
}
for p in (root/'docs/hardening/perception/recorded').glob('*.json'):
 fixtures[p.relative_to(root).as_posix()]='tests/fixtures/perception/recorded/'+p.name.removeprefix('f1-tierc-')
def normalize(text):
 for old,new in sorted(replacements.items(),key=lambda p:-len(p[0])):text=text.replace(old,new)
 return text
renames,deletions,writes=[],[],[]
for old in tracked:
 p=root/old
 if old.startswith('.github/'):continue
 if not p.exists():continue
 if old in fixtures:new=fixtures[old]
 elif old.startswith('docs/') and not old.startswith(('docs/Products/','docs/Engineering/')) and old!='docs/README.md':
  deletions.append(old);continue
 elif old.startswith('artifacts/'):
  deletions.append(old);continue
 else:new=normalize(old)
 new=new.replace('experiments/agent-execution/l2/','experiments/agent-execution/recovery-harness/')
 if new!=old:
  assert not (root/new).exists(),f'Rename collision: {new}'
  renames.append((old,new))
 data=p.read_bytes()
 try:text=data.decode('utf-8')
 except UnicodeDecodeError:
  writes.append((new,data));continue
 for src,dest in fixtures.items():
  if src.startswith('artifacts/') and not ('.test.' in old or old.startswith('tests/')):continue
  text=text.replace(src,dest)
 text=text.replace('docs/hardening/perception/recorded','tests/fixtures/perception/recorded')
 text=text.replace('perception-research:','perception:research:').replace('perception-validation:','perception:validation:')
 text=normalize(text).replace('SqliteTaskStateRepository','SqliteTaskStore')
 text=text.replace('experiments/agent-execution/l2/','experiments/agent-execution/recovery-harness/')
 text=text.replace('experiments/agent-execution/l2"','experiments/agent-execution/recovery-harness"')
 text=text.replace('docs/experiments/artifacts/','artifacts/verification/')
 if old.startswith('experiments/'):
  text=text.replace('phase5-','agent-execution-').replace('rove-p59-l2-','rove-process-recovery-').replace('rove-p50-','rove-agent-schema-')
  text=text.replace('Rove Live Acceptance P5.9','Rove Browser Acceptance').replace('[p5.9-l2]','[process-recovery]')
 if old.endswith('electron-sqlite-gate0.cjs'):text=text.replace('gate0','integrity')
 if '.test.' in old:
  text=text.replace('Rove Live Acceptance P5.9','Rove Browser Acceptance').replace('[p5.9-l2]','[process-recovery]')
  text=re.sub(r'(?<=\")Phase [0-9]+\s*','',text)
  text=re.sub(r'(?<=\")P[0-9]+\.[0-9]+\s*','',text)
  text=re.sub(r'(?<=\")Gate [0-9]+\s*','',text)
  text=re.sub(r'describe\(\"F1 Gate [^\"]*\"','describe('+json.dumps(Path(new).name.split('.test.')[0].replace('-',' ')),text)
  text=text.replace('interface GateDatabase','interface LedgerTestDatabase').replace('Kysely<GateDatabase>','Kysely<LedgerTestDatabase>')
 if old=='apps/companion/src/renderer/styles.css':text=text.replace('Phase 5 native product surface','Native product surface')
 if old.endswith('lifecycle-contract.ts'):text=text.replace('accepted P5.9 lifecycle contract','task lifecycle contract')
 writes.append((new,text.encode()))
assert all(p.startswith(('docs/','artifacts/')) for p in deletions)
for old,new in renames:(root/old).unlink()
for old in deletions:(root/old).unlink()
for new,data in writes:
 p=root/new;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
for d in sorted((p for p in root.rglob('*') if p.is_dir() and '.git' not in p.parts),key=lambda p:-len(p.parts)):
 if not any(d.iterdir()):d.rmdir()
p=root/'.gitignore';s=p.read_text()
if '\nartifacts/\n' not in s:s+='\n# Generated qualification reports, recordings, and installers.\nartifacts/\n'
p.write_text(s)
for name in ['package.json','apps/companion/package.json']:
 p=root/name;j=json.loads(p.read_text());j['description']='Task and workflow assistant for getting digital work done'
 if name=='package.json':
  j['scripts']['check:repository']='node scripts/check-repository.mjs'
  j['scripts']['test:experiments']='node --test experiments/agent-execution/*.test.mjs'
 p.write_text(json.dumps(j,indent=2)+'\n')
report={'renamed':renames,'removed':deletions,'retained_fixtures':fixtures,'preserved_compatibility':['phase5-effect-journal-v1','0001_durable_task_ledger','0002_task_engine_event_aggregate_outbox','Codex 0.153.4 generated schemas']}
Path('/tmp/rove-reconciliation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'renamed':len(renames),'removed':len(deletions),'retained_fixtures':len(fixtures)}))
