import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workflows, routineFor } from '../solo.mjs';
import { install } from '../scripts/install-solo.mjs';
import { loadRoster } from '../roster.mjs';
import { file, load, withState, due } from '../routines.mjs';
import { loadSkills } from '../skills.mjs';

const agents=loadRoster().agents;
function scratch(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-solo-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}
test('install preserves existing routines and never enables background work',t=>{
 const brain=scratch(t),p=file(brain);fs.mkdirSync(path.dirname(p),{recursive:true});
 const existing={...routineFor(workflows[0]),id:'existing-owner-routine',paused:false,text:'Owner text'};
 fs.writeFileSync(p,JSON.stringify({custom:'preserve',routines:[existing]}));
 const result=install(brain,agents);assert.equal(result.added,40);
 const saved=JSON.parse(fs.readFileSync(p));assert.equal(saved.custom,'preserve');assert.deepEqual(saved.routines[0],existing);
 const added=saved.routines.slice(1);assert.ok(added.every(r=>r.paused));assert.equal(load(brain,agents).problems.length,0);
 const st={};withState(added,st,Date.now());assert.equal(due(added,st,Date.now()+30*864e5).length,0);
 assert.equal(loadSkills(brain,agents).summary().problems.length,0);
});
test('reinstallation preserves owner-edited routines and skills',t=>{
 const brain=scratch(t);install(brain,agents);const p=file(brain),doc=JSON.parse(fs.readFileSync(p));
 doc.routines[0].text='Customized';doc.routines[0].paused=false;fs.writeFileSync(p,JSON.stringify(doc));
 const skill=path.join(brain,'Agents Office/skills/solo-retainers/SKILL.md');fs.appendFileSync(skill,'\nOwner note.\n');
 assert.equal(install(brain,agents).added,0);assert.equal(JSON.parse(fs.readFileSync(p)).routines[0].text,'Customized');
 assert.equal(JSON.parse(fs.readFileSync(p)).routines[0].paused,false);assert.ok(fs.readFileSync(skill,'utf8').endsWith('Owner note.\n'));
});
test('invalid existing routine data is not overwritten',t=>{
 const brain=scratch(t),p=file(brain);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'{"unexpected":true}');
 assert.throws(()=>install(brain,agents),/invalid/);assert.equal(fs.readFileSync(p,'utf8'),'{"unexpected":true}');
});
