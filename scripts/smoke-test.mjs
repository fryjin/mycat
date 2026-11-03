import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const appSource = fs.readFileSync(new URL('../public/assets/app.js', import.meta.url), 'utf8');
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
const state = {
  version: 6, demo: false,
  pets: [
    {id:'blue',name:'蓝猫',breed:'英短',tone:'blue',sex:'公猫',birthday:'',neutered:'已绝育',chip:'',allergy:'',notes:''},
    {id:'silver',name:'银点',breed:'银点',tone:'silver',sex:'母猫'},
    {id:'tux',name:'奶牛猫',breed:'中华田园猫',tone:'tux',sex:'母猫'}
  ], records: [], tasks: [], changes: [],
  settings: {push:true,email:false,internal:true,dual:false,quiet:true,quietFrom:'22:00',quietTo:'08:00',mail:''},
  members: [{name:'炮台',role:'管理员'},{name:'芋头',role:'家庭成员'}]
};
const appNode = {innerHTML:''};
const toastNode = {innerHTML:''};
const listeners = {};
const fieldValues = new Map();
let draftInputs = [];
const requests = [];
const document = {
  querySelector(selector) {
    if (selector === '#app') return appNode;
    if (selector === '#toast-area') return toastNode;
    if (selector === '#authForm') return null;
    if (selector === '#petAvatarUpload' || selector === '#uploadFile' || selector === '#importData') return null;
    if (selector === '#moveDate' || selector === '#moveReason') return null;
    const match = selector.match(/^\[name="([^"]+)"\]$/);
    if (match) return draftInputs.find(x => x.name === match[1]) || null;
    return null;
  },
  querySelectorAll(selector) { return selector === '[data-draft]' ? draftInputs : []; },
  getElementById(id) { return fieldValues.has(id) ? {value: fieldValues.get(id)} : null; },
  addEventListener(type, callback) { (listeners[type] ||= []).push(callback); },
  createElement() { return {click(){},remove(){},set href(v){},set download(v){}}; },
  body: {appendChild(){}}
};
const localStorage = {setItem(){},getItem(){return null}};
const fetch = async (url, options={}) => {
  const method = (options.method || 'GET').toUpperCase();
  if (url === '/api/me') return {ok:true,status:200,json:async()=>({user:{id:'u1',name:'炮台'},family:{id:'f1'}})};
  if (url === '/api/state' && method === 'GET') return {ok:true,status:200,json:async()=>({state:structuredClone(state),revision:0})};
  if (url === '/api/state' && method === 'PUT') {
    const body = JSON.parse(options.body);
    Object.assign(state, body.state);
    requests.push({url,body});
    return {ok:true,status:200,json:async()=>({revision:requests.length})};
  }
  if (url === '/api/preferences') return {ok:true,status:200,json:async()=>({ok:true})};
  throw new Error(`Unexpected API ${method} ${url}`);
};
const context = {
  document, localStorage, fetch, Headers, FormData, Date, Math, JSON, Map, Set, Array, Object, String, Number, Promise, Error,
  console, window:{scrollTo(){}}, setTimeout:(fn)=>0, clearTimeout(){}, confirm:()=>true
};
vm.runInNewContext(appSource, context, {filename:'app.js'});
const wait = async (fn, label) => {
  for (let i=0;i<100;i++) { if (fn()) return; await new Promise(r=>setTimeout(r,5)); }
  throw new Error(`Timed out waiting for ${label}`);
};
const click = (action,id='') => {
  const node = {dataset:{action,id},closest(){return this}};
  for (const fn of listeners.click || []) fn({target:node});
};

await wait(()=>appNode.innerHTML.includes('brand-name'),'cloud bootstrap');
assert.match(appNode.innerHTML,/三喵健康簿/,'app shell rendered');

// Pet edit modal must render and save without a runtime exception.
click('go','pets');
assert.match(appNode.innerHTML,/data-action="edit-pet"/,'pet page rendered');
click('edit-pet','blue');
assert.match(appNode.innerHTML,/id="f_pet_name"/,'pet edit name field rendered');
assert.match(appNode.innerHTML,/id="f_pet_birthday"/,'pet edit date field rendered');
for (const [id,value] of Object.entries({
  f_pet_name:'蓝猫测试名', f_pet_breed:'英短', f_pet_birthday:'', f_pet_sex:'公猫',
  f_pet_neutered:'已绝育', f_pet_chip:'', f_pet_allergy:'', pet_notes:''
})) fieldValues.set(id,value);
click('save-pet','blue');
await wait(()=>requests.length>=1,'pet profile cloud sync');
assert.equal(state.pets[0].name,'蓝猫测试名','pet profile saved');
assert.equal(state.changes.length,1,'pet change history saved');

// Weight record form must render with numeric constraints, save, sync, and appear in trend.
click('go','add');
assert.match(appNode.innerHTML,/记下今天的照顾/,'add page rendered');
click('create-type','weight');
assert.match(appNode.innerHTML,/id="f_weight"/,'weight input rendered');
draftInputs = [
  {name:'date',value:today},
  {name:'weight',value:'4.35'}
];
click('save-create');
await wait(()=>requests.length>=2,'weight cloud sync');
assert.equal(state.records.length,1,'weight record created');
assert.equal(state.records[0].type,'weight','record type is weight');
assert.equal(state.records[0].weightKg,4.35,'numeric weight persisted');
assert.equal(state.records[0].weight,'4.35','legacy weight field persisted');

click('go','pets');
click('pet-sub','trend');
assert.match(appNode.innerHTML,/weight-trend-summary/,'weight trend summary rendered');
assert.match(appNode.innerHTML,/4\.35/,'weight trend contains saved value');
assert.match(appNode.innerHTML,/1 次称重/,'single measurement count rendered');

// A regular health record must still save through the same form path.
click('go','add');
click('create-type','checkup');
draftInputs = [{name:'date',value:today},{name:'detail',value:'年度体检'}];
click('save-create');
await wait(()=>requests.length>=3,'regular record cloud sync');
assert.equal(state.records.length,2,'regular health record created');
assert.equal(state.records[0].type,'checkup','regular record type saved');

console.log('PASS: pet edit modal render + save; weight input render + save; D1 state sync; one-point weight trend; regular health record save.');
