import test from 'node:test';
import assert from 'node:assert/strict';
import { scratch, startOffice } from './helpers.mjs';
import { readBusiness, mutateBusiness, allowance } from '../business.mjs';
const client={name:'Test account',contact:'Fixture only',services:['Design','Development'],stage:'Active',fee:'100',currency:'INR',allowance:'10',agreement:'Fixture agreement',goals:'Fixture goals',renewalDate:'',noticeDays:''};
function setup(t){const s=scratch('business');t.after(s.cleanup);const run=(action,data)=>mutateBusiness(s.data,{revision:readBusiness(s.data).revision,action,data});return {...s,run}}
test('complete retainer cycle persists evidence and prevents invalid transitions',t=>{
 const s=setup(t),c=s.run('client',client).entity;
 const p=s.run('period',{clientId:c,start:'2026-09-15',end:'2026-10-14',allowance:'10',fee:'100',priorities:'Test'}).entity;
 const r=s.run('request',{periodId:p,title:'Design page',description:'Acceptance criteria',service:'Design',hours:'6',scope:'Included',due:'2026-10-01'}).entity;
 assert.equal(allowance(readBusiness(s.data),p).remaining,4);
 assert.throws(()=>s.run('request',{periodId:p,title:'Too large',service:'Design',hours:5,scope:'Included'}),/exceeds/);
 assert.throws(()=>s.run('work',{id:r,status:'Delivered'}),/approval/);
 s.run('work',{id:r,status:'In progress'});s.run('deliverable',{id:r,reference:'artifact-v1'});
 let version=readBusiness(s.data).requests[0].version;
 s.run('approval',{id:r,version,by:'Client contact',evidence:'Approved in fixture record'});
 s.run('deliverable',{id:r,reference:'artifact-v2'});
 assert.equal(readBusiness(s.data).requests[0].approval,null);
 assert.throws(()=>s.run('approval',{id:r,version,by:'Contact',evidence:'Old approval'}),/changed/);
 version=readBusiness(s.data).requests[0].version;s.run('approval',{id:r,version,by:'Contact',evidence:'New approval'});
 s.run('work',{id:r,status:'Delivered'});
 assert.throws(()=>s.run('close-period',{id:p,summary:'Done'}),/paid invoice/);
 const invoice=s.run('invoice',{periodId:p,reference:'TEST-1',due:'2026-10-14'}).entity;
 assert.throws(()=>s.run('invoice',{periodId:p,reference:'TEST-2',due:'2026-10-14'}),/already/);
 assert.throws(()=>s.run('invoice-status',{id:invoice,status:'Paid',evidence:'fixture'}),/not allowed/);
 s.run('invoice-status',{id:invoice,status:'Issued',evidence:'issued externally'});
 s.run('invoice-status',{id:invoice,status:'Paid',evidence:'payment record'});
 s.run('close-period',{id:p,summary:'Complete fixture period'});
 const saved=readBusiness(s.data);assert.equal(saved.periods[0].closed,true);assert.equal(saved.invoices[0].paymentEvidence,'payment record');
 assert.equal(saved.events.filter(e=>e.type==='approval').length,2);assert.equal(saved.events.find(e=>e.type==='approval').snapshot.approval.evidence,'Approved in fixture record');
 assert.throws(()=>s.run('request',{periodId:p}),/closed/);
});
test('stale edits, invalid dates and overlapping periods leave state unchanged',t=>{
 const s=setup(t),c=s.run('client',client).entity;
 assert.throws(()=>mutateBusiness(s.data,{revision:0,action:'client',data:client}),/another window/);
 assert.throws(()=>s.run('period',{clientId:c,start:'2026-02-30',end:'2026-03-31',fee:10,allowance:10}),/valid date/);
 assert.equal(readBusiness(s.data).periods.length,0);
 s.run('period',{clientId:c,start:'2026-09-01',end:'2026-09-30',fee:10,allowance:10});
 assert.throws(()=>s.run('period',{clientId:c,start:'2026-09-20',end:'2026-10-20',fee:10,allowance:10}),/overlaps/);
 s.run('client',{...client,id:c,fee:'200',agreement:'Updated'});
 const d=readBusiness(s.data);assert.equal(d.periods[0].fee,10);assert.equal(d.periods[0].terms,'Fixture agreement');
});
test('additional requests cannot start without recorded scope evidence',t=>{
 const s=setup(t),c=s.run('client',client).entity,p=s.run('period',{clientId:c,start:'2026-09-01',end:'2026-09-30',fee:10,allowance:10}).entity;
 const r=s.run('request',{periodId:p,title:'Additional',service:'Development',hours:5,scope:'Additional'}).entity;
 assert.throws(()=>s.run('work',{id:r,status:'In progress'}),/Resolve scope/);
 s.run('scope',{id:r,evidence:'Owner approved quoted change TEST-Q1'});s.run('work',{id:r,status:'In progress'});
 assert.equal(allowance(readBusiness(s.data),p).committed,0);
});
test('business API hands stored client context to the CLI task engine',async t=>{
 const s=setup(t);const c=s.run('client',client).entity;
 const office=await startOffice({brain:s.brain,data:s.data});t.after(()=>office.stop());
 const response=await office.api('POST','/api/business/prepare',{clientId:c,workflow:'solo-monthly-plan',context:'Use the agreement.'});
 assert.equal(response.status,200);assert.equal(response.body.needsOk,false);assert.match(response.body.text,/Fixture agreement/);assert.equal(response.body.businessClient,c);
 const completed=await office.until(response.body.id,t=>t.state==='done');assert.equal(!!completed.error,false);
 assert.ok(office.calls().some(call=>call.mode==='readonly'));
 const bad=await office.api('POST','/api/business',{revision:0,action:'settings',data:{}});assert.equal(bad.status,409);
});
