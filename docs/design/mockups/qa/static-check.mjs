import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const req=createRequire('/private/tmp/todoer-qa/package.json');const {Window}=req('happy-dom');
let checks=0;const fail=[];
for(const file of ['index.html','ux.html','calendar.html','view-form.html','task-dialogs.html','gate.html','states.html']){
 const text=fs.readFileSync(file,'utf8'),w=new Window();w.document.write(text);
 for(const n of w.document.querySelectorAll('[src],[href]')){let url=n.getAttribute('src')||n.getAttribute('href');if(!url||/^(https?:|#|data:|mailto:)/.test(url))continue;url=url.split(/[?#]/)[0];if(!fs.existsSync(path.resolve(path.dirname(file),url)))fail.push(file+' missing '+url);checks++;}
 if(/\{\{/.test(text))fail.push(file+' placeholder');
 if((text.match(/<script\b/g)||[]).length!==(text.match(/<\/script>/g)||[]).length)fail.push(file+' script tags');
 if(text.includes('does not implement a calendar'))fail.push(file+' stale calendar copy');
 await w.happyDOM.close();
}
for(const file of ['ux.js','screens.js','gate.js','states.js',...fs.readdirSync('domain').map(x=>'domain/'+x)]){new Function(fs.readFileSync(file,'utf8'));checks++;}
if(fs.readFileSync('tokens.css','utf8')!==fs.readFileSync('/Users/kkucherenkov/orca/todoer/docs/design/tokens.css','utf8'))fail.push('token drift');
console.log('LOCAL LINKS / SCRIPT SYNTAX / PLACEHOLDERS / TOKEN PARITY: '+checks+' checks; '+fail.length+' failures');if(fail.length){console.log(fail.join('\n'));process.exitCode=1;}
