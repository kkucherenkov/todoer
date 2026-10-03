import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const checks=[['dom-and-vue-compile','qa/check.mjs','qa/results.txt'],['static','qa/static-check.mjs','qa/static-results.txt']];const results=[];
for(const [name,file,out] of checks){const r=spawnSync(process.execPath,[file],{encoding:'utf8'});fs.writeFileSync(out,r.stdout+r.stderr);results.push({name,command:`"$OD_NODE_BIN" ${file}`,exit:r.status});}
let r=spawnSync(process.execPath,['qa/typecheck.mjs'],{encoding:'utf8'});
if(r.status===0){r=spawnSync(process.execPath,['/Users/kkucherenkov/orca/todoer/node_modules/.pnpm/vue-tsc@3.3.11_typescript@5.9.3/node_modules/vue-tsc/bin/vue-tsc.js','-p','qa/tsconfig.json','--noEmit'],{encoding:'utf8'});fs.writeFileSync('qa/type-results.txt',r.stdout+r.stderr);}
results.push({name:'vue-typecheck',command:'"$OD_NODE_BIN" qa/typecheck.mjs; "$OD_NODE_BIN" /Users/kkucherenkov/orca/todoer/node_modules/.pnpm/vue-tsc@3.3.11_typescript@5.9.3/node_modules/vue-tsc/bin/vue-tsc.js -p qa/tsconfig.json --noEmit',exit:r.status});
fs.writeFileSync('qa/status.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(r=>r.exit!==0))process.exitCode=1;
