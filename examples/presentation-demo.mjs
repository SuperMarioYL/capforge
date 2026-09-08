import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forge, verifySkill } from '../dist/forge/provenance.js';
const task=JSON.parse(await readFile('examples/task-slugify.json','utf8'));
const home=await mkdtemp(join(tmpdir(),'capforge-demo-'));
try {
 const r=await forge(task,{provider:'auto',model:null},{home,mock:true});
 const v=await verifySkill(r.id,home);
 console.log(JSON.stringify({goal:task.goal,inputs:task.example_inputs,test_pass:r.test.pass,signed:r.signed,signature_valid:v.sig_valid,model:r.record.synthesis.model},null,2));
 if(!v.sig_valid || !r.test.pass) process.exitCode=1;
} finally { await rm(home,{recursive:true,force:true}); }
