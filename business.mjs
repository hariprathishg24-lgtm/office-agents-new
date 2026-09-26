import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON } from './store.mjs';

export class BusinessError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const fail=(message,status)=>{throw new BusinessError(message,status)};
const str=(value,label,max=4000,required=true)=>{if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))fail(`${label} is required and must be at most ${max} characters.`);return value.trim()};
const num=(value,label)=>{if(!['string','number'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>1e9)fail(`${label} must be a non-negative number.`);return Number(value)};
const date=(value,label,optional=false)=>{if(optional&&!value)return '';const parsed=new Date(value);if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail(`${label} must be a valid date.`);return value};
const pick=(value,choices,label)=>choices.includes(value)?value:fail(`Choose a valid ${label}.`);
const find=(list,id,label)=>list.find(x=>x.id===id)||fail(`${label} not found.`,404);
const id=()=>randomUUID();
export const services=['Design','Development','Marketing','Automation'];
export const stages=['Lead','Proposal','Onboarding','Active','Offboarding','Archived'];
export const workStates=['Ready','In progress','Waiting','Review','Delivered','Cancelled'];
export function emptyBusiness(){return {version:1,revision:0,settings:{name:'Origin Pixel Solutions',services,workingHours:'',capacityHours:null,setupComplete:false},clients:[],periods:[],requests:[],invoices:[],events:[]}}
export function readBusiness(dataDir){const d=readJSON(path.join(dataDir,'business.json'),null);if(!d)return emptyBusiness();if(d.version!==1||!Number.isSafeInteger(d.revision)||!['clients','periods','requests','invoices','events'].every(k=>Array.isArray(d[k])))fail('Business records need repair; they have not been overwritten.',500);return d}
const audit=(d,type,entity,detail)=>d.events.push({id:id(),at:new Date().toISOString(),type,entity,detail,snapshot:structuredClone(entity==='business'?d.settings:[...d.clients,...d.periods,...d.requests,...d.invoices].find(x=>x.id===entity))});
const openPeriod=(d,periodId)=>{const p=find(d.periods,periodId,'Period');if(p.closed)fail('This period is closed.');return p};
export function allowance(d,periodId){const p=find(d.periods,periodId,'Period');const rs=d.requests.filter(r=>r.periodId===p.id&&r.scope==='Included'&&r.status!=='Cancelled');const committed=rs.reduce((s,r)=>s+r.hours,0);const completed=rs.filter(r=>r.status==='Delivered').reduce((s,r)=>s+r.hours,0);return {included:p.allowance,committed,completed,remaining:p.allowance===null?null:p.allowance-committed}}

export function mutateBusiness(dataDir,command){
 const d=readBusiness(dataDir);
 if(command.revision!==d.revision)fail('Records changed in another window. Refresh and try again.',409);
 const b=command.data||{};let entity;
 switch(command.action){
 case 'settings':
  d.settings={...d.settings,name:str(b.name,'Business name',120),workingHours:str(b.workingHours||'','Working hours',300,false),capacityHours:b.capacityHours===''||b.capacityHours===null?null:num(b.capacityHours,'Weekly capacity'),setupComplete:true};entity='business';break;
 case 'client':{
  const prior=b.id?find(d.clients,b.id,'Client'):null;
  const selected=Array.isArray(b.services)?b.services.filter(s=>services.includes(s)):[];
  if(!selected.length)fail('Choose at least one service.');
  const currency=str(b.currency,'Currency',3).toUpperCase();if(!/^[A-Z]{3}$/.test(currency))fail('Use a three-letter currency code.');
  const c={id:prior?.id||id(),name:str(b.name,'Client name',120),contact:str(b.contact||'','Contact',200,false),services:[...new Set(selected)],stage:pick(b.stage,stages,'client stage'),fee:num(b.fee,'Retainer fee'),currency,allowance:b.allowance===''||b.allowance===null?null:num(b.allowance,'Included hours'),agreement:str(b.agreement||'','Agreement terms',12000,false),goals:str(b.goals||'','Client goals',4000,false),renewalDate:date(b.renewalDate,'Renewal date',true),noticeDays:b.noticeDays===''||b.noticeDays===null?null:num(b.noticeDays,'Notice days'),updatedAt:new Date().toISOString()};
  if(prior)Object.assign(prior,c);else d.clients.push(c);entity=c.id;break;}
 case 'period':{
  const c=find(d.clients,b.clientId,'Client');if(c.stage==='Archived')fail('Restore the client before opening a period.');
  const start=date(b.start,'Period start'),end=date(b.end,'Period end');if(end<start)fail('Period end must follow its start.');
  if(d.periods.some(p=>p.clientId===c.id&&p.start<=end&&p.end>=start))fail('This overlaps an existing contract period.');
  const p={id:id(),clientId:c.id,start,end,allowance:b.allowance===''||b.allowance===null?null:num(b.allowance,'Period allowance'),fee:num(b.fee,'Period fee'),currency:c.currency,terms:c.agreement,priorities:str(b.priorities||'','Priorities',4000,false),closed:false};d.periods.push(p);entity=p.id;break;}
 case 'request':{
  const p=openPeriod(d,b.periodId),c=find(d.clients,p.clientId,'Client');
  const service=pick(b.service,services,'service');if(!c.services.includes(service))fail('This service is not on the client’s package. Update their agreement first.');
  const hours=num(b.hours,'Estimated hours'),scope=pick(b.scope,['Included','Additional','Unclear'],'scope');
  const current=b.id?find(d.requests,b.id,'Request'):null;if(current&&current.periodId!==p.id)fail('A request cannot move between periods.');if(current?.status==='Delivered')fail('Delivered work is locked; record a new request for changes.');
  const remaining=allowance(d,p.id).remaining;const previous=current?.scope==='Included'&&current.status!=='Cancelled'?current.hours:0;
  if(scope==='Included'&&remaining!==null&&hours>remaining+previous)fail('This exceeds the remaining allowance. Mark it Additional or Unclear for review.');
  const r={id:current?.id||id(),clientId:c.id,periodId:p.id,title:str(b.title,'Request',180),description:str(b.description||'','Brief',6000,false),service,hours,scope,due:date(b.due,'Deadline',true),status:scope==='Included'?'Ready':'Waiting',version:(current?.version||0)+1,deliverable:current?.deliverable||'',approval:null,updatedAt:new Date().toISOString()};if(current)Object.assign(current,r);else d.requests.push(r);entity=r.id;break;}
 case 'work':{
  const r=find(d.requests,b.id,'Request');openPeriod(d,r.periodId);const next=pick(b.status,workStates,'work status');
  if(r.status==='Delivered'||r.status==='Cancelled')fail('Completed or cancelled work is locked. Create a new request.');
  if(!['Waiting','Cancelled'].includes(next)&&r.scope!=='Included'&&!r.scopeEvidence)fail('Resolve scope before starting this work.');
  if(next==='Review'&&!r.deliverable)fail('Add a deliverable reference before review.');
  if(next==='Delivered'&&(!r.approval||r.approval.version!==r.version||r.status!=='Review'))fail('Record approval of the current version before delivery.');
  r.status=next;entity=r.id;break;}
 case 'scope':{
  const r=find(d.requests,b.id,'Request');openPeriod(d,r.periodId);if(['Delivered','Cancelled'].includes(r.status))fail('This request is locked.');
  r.scopeEvidence=str(b.evidence,'Scope decision evidence',2000);r.status='Ready';entity=r.id;break;}
 case 'deliverable':{
  const r=find(d.requests,b.id,'Request');openPeriod(d,r.periodId);if(['Delivered','Cancelled'].includes(r.status))fail('This request is locked.');
  if(r.scope!=='Included'&&!r.scopeEvidence)fail('Resolve scope before submitting work.');
  r.deliverable=str(b.reference,'Deliverable link or reference',2000);r.version++;r.approval=null;r.status='Review';entity=r.id;break;}
 case 'approval':{
  const r=find(d.requests,b.id,'Request');openPeriod(d,r.periodId);if(r.status!=='Review'||!r.deliverable)fail('Only a submitted deliverable can be approved.');
  if(b.version!==r.version)fail('The deliverable changed. Review the new version.',409);
  r.approval={version:r.version,by:str(b.by,'Approver',150),evidence:str(b.evidence,'Approval evidence',2000),at:new Date().toISOString()};entity=r.id;break;}
 case 'invoice':{
  const p=find(d.periods,b.periodId,'Period');
  if(d.invoices.some(i=>i.periodId===p.id&&i.status!=='Void'))fail('This period already has an invoice record.');
  const i={id:id(),clientId:p.clientId,periodId:p.id,reference:str(b.reference,'Invoice reference',100),amount:p.fee,currency:p.currency,due:date(b.due,'Due date'),status:'Draft',paymentEvidence:'',createdAt:new Date().toISOString()};
  if(d.invoices.some(x=>x.reference.toLowerCase()===i.reference.toLowerCase()))fail('Invoice reference already exists.');d.invoices.push(i);entity=i.id;break;}
 case 'invoice-status':{
  const i=find(d.invoices,b.id,'Invoice');const next=pick(b.status,['Issued','Paid','Disputed','Void'],'invoice status');
  const allowed={Draft:['Issued','Void'],Issued:['Paid','Disputed','Void'],Disputed:['Issued','Paid','Void'],Paid:[],Void:[]};if(!allowed[i.status]?.includes(next))fail('This invoice status change is not allowed.');
  const evidence=str(b.evidence,'Status evidence',2000);i.status=next;i.statusEvidence=evidence;if(next==='Paid')i.paymentEvidence=evidence;entity=i.id;break;}
 case 'close-period':{
  const p=openPeriod(d,b.id);if(d.requests.some(r=>r.periodId===p.id&&!['Delivered','Cancelled'].includes(r.status)))fail('Resolve unfinished requests before closing the period.');
  if(!d.invoices.some(i=>i.periodId===p.id&&i.status==='Paid'))fail('Reconcile a paid invoice before closing this period.');
  p.closed=true;p.closedAt=new Date().toISOString();p.summary=str(b.summary,'Period summary',4000);entity=p.id;break;}
 default:fail('Unknown business action.');
 }
 d.revision++;audit(d,command.action,entity,command.action==='approval'?'Approval recorded for the current deliverable version':command.action==='client'?'Client record saved':`Owner recorded ${command.action}`);
 writeJSON(path.join(dataDir,'business.json'),d);return {state:d,entity};
}

export function clientContext(d,clientId){const c=find(d.clients,clientId,'Client');return JSON.stringify({client:c,periods:d.periods.filter(p=>p.clientId===c.id),requests:d.requests.filter(r=>r.clientId===c.id),invoices:d.invoices.filter(i=>i.clientId===c.id)},null,2)}
