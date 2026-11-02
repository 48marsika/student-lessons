const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto,randomBytes,createCipheriv,createHmac}=require('node:crypto');

const html=fs.readFileSync('student.html','utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function harness(payload){
 const elements=new Map();
 class Element{
  constructor(){this.textContent='';this.style={};this.dataset={};this.events={};this.children=[];this.value='4';}
  addEventListener(name,callback){this.events[name]=callback;}
  getAttribute(name){return this[name];}
  removeAttribute(name){delete this[name];}
  insertAdjacentElement(_,el){elements.set(el.id,el);}
  replaceChildren(){this.children=[];}
  append(el){this.children.push(el);}
 }
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const body=new Element();
 let interval;
 class Today extends Date{constructor(...args){super(...(args.length?args:['2026-11-02T12:00:00+03:00']));}}
 const context={document:{getElementById:get,createElement:()=>new Element(),body,querySelectorAll:()=>[]},
  Date:Today,Number,Set,Map,Array,String,JSON,URLSearchParams,Uint8Array,TextEncoder,TextDecoder,
  atob,crypto:webcrypto,location:{search:'',hash:''},navigator:{},
  setInterval:callback=>{interval=callback;},
  fetch:async()=>({ok:true,json:async()=>payload})};
 vm.createContext(context);
 vm.runInContext(source.replace('setSeason();\nloadStudent();',
  'globalThis.api={monthlyBalance,loadStudent,setStudent(value){student=value;},show(ym){index=keys.indexOf(ym);render();}};\nsetSeason();'),context);
 return {api:context.api,get,context,refresh:()=>interval()};
}
const {api}=harness();
const record=(ym,subscription,count=0)=>({ym,subscription,dates:Array.from({length:count},(_,i)=>`${ym}-${String(i+1).padStart(2,'0')}`)});
const balance=(months,ym)=>JSON.parse(JSON.stringify(api.monthlyBalance(months,ym)));

test('October through January: new subscriptions and unique lessons counted once',()=>{
 const months=[record('2026-10',8,5),record('2026-11',4,6),record('2026-12',8,3),record('2027-01',0,2)];
 const original=JSON.stringify(months);
 for(let repeat=0;repeat<5;repeat++){
  assert.deepEqual(balance(months,'2026-10'),{carried:0,remaining:3});
  assert.deepEqual(balance(months,'2026-11'),{carried:3,remaining:1});
  assert.deepEqual(balance(months,'2026-12'),{carried:1,remaining:6});
  assert.deepEqual(balance(months,'2027-01'),{carried:6,remaining:4});
 }
 assert.equal(JSON.stringify(months),original);
});
test('blank subscription, missing months, numeric strings, and duplicate dates',()=>{
 const oct=record('2026-10','8',5);oct.dates.push(oct.dates[0]);
 const months=[record('2027-01',4,1),record('2026-12',null,1),oct];
 assert.deepEqual(balance(months,'2026-11'),{carried:3,remaining:3});
 assert.deepEqual(balance(months,'2026-12'),{carried:3,remaining:2});
 assert.deepEqual(balance(months,'2027-01'),{carried:2,remaining:5});
 assert.deepEqual(balance([record('2026-10','')],'2026-11'),{carried:0,remaining:null});
 assert.deepEqual(balance([record('2026-10',0)],'2026-11'),{carried:0,remaining:0});
});
test('debt is not discarded; exhausted balance does not create credits',()=>{
 const months=[record('2026-10',2,4),record('2026-11',4,1),record('2026-12',null,1)];
 assert.deepEqual(balance(months,'2026-11'),{carried:-2,remaining:1});
 assert.deepEqual(balance(months,'2026-12'),{carried:1,remaining:0});
 assert.deepEqual(balance(months,'2027-01'),{carried:0,remaining:0});
});
test('past edits recompute later months; future subscriptions do not affect the past',()=>{
 const months=[record('2026-10',8,5),record('2026-11',4,2),record('2027-12',100)];
 assert.equal(balance(months,'2026-11').remaining,5);
 months[0].dates.push('2026-10-06');
 assert.equal(balance(months,'2026-11').remaining,4);
 months[0].subscription=9;
 assert.equal(balance(months,'2026-11').remaining,5);
 assert.equal(balance(months,'2026-10').remaining,3);
});
test('history before the first displayed month and duplicate month records are not counted twice',()=>{
 const oct=record('2026-10',4,1);
 assert.deepEqual(balance([record('2026-09',5,3),oct,oct],'2026-11'),{carried:5,remaining:5});
});
test('real encrypted v1 payload opens with existing personal link; navigation and refresh stay idempotent',async()=>{
 const student={name:'Test student',price:1200,minutes:60,months:[record('2026-10',8,5),record('2026-11',4,2),record('2026-12',null,1)]};
 const id='a'.repeat(32),key=randomBytes(64),iv=randomBytes(16);
 const cipher=createCipheriv('aes-256-cbc',key.subarray(0,32),iv);
 const ct=Buffer.concat([cipher.update(JSON.stringify(student)),cipher.final()]);
 const mac=createHmac('sha256',key.subarray(32)).update(Buffer.concat([Buffer.from('lessons-v1:'+id),iv,ct])).digest();
 const payload={records:{[id]:{v:1,iv:iv.toString('base64url'),ct:ct.toString('base64url'),mac:mac.toString('base64url')}}};
 const original=JSON.stringify(payload),h=harness(payload);
 h.context.location={search:'?u='+id,hash:'#k='+key.toString('base64url')};
 await h.api.loadStudent();
 assert.equal(h.get('studentName').textContent,'Test student');
 for(let i=0;i<3;i++){
  h.api.show('2026-11');
  assert.equal(h.get('subscription').textContent,'4');
  assert.equal(h.get('remaining').textContent,'5');
  assert.match(h.get('carryoverNotice').textContent,/из прошлого месяца: 3/);
  assert.equal(h.get('carryoverNotice').hidden,false);
  assert.equal(h.get('completed').textContent,'Проведено: 2');
  assert.equal(h.get('days').children.filter(el=>el.children.length).length,2);
  h.get('next').events.click();
  assert.equal(h.get('subscription').textContent,'—');
  assert.equal(h.get('remaining').textContent,'4');
  h.get('prev').events.click();
  assert.equal(h.get('remaining').textContent,'5');
  h.refresh();
  await h.api.loadStudent();
  assert.equal(h.get('remaining').textContent,'5');
 }
 h.api.show('2026-10');
 assert.match(h.get('carryoverNotice').textContent,/в следующий месяц: 3/);
 assert.equal(JSON.stringify(payload),original);
 assert.equal(h.get('price').textContent,'1 200');
 assert.equal(h.get('minutes').textContent,'60');
});
