/* Squadron Resource Manager. No web requests, tracking, logins, or remote services. */
(() => {
'use strict';
const APP_VERSION = '1.4';
const STORAGE_KEY = 'pa035-squadron-resources-offline-v1';
const isNative = () => !!window.Device; // true inside the Android APK
const names = {duty:'Duty Assignment Report',qualifications:'All Qualification Listing',tracks:'Specialty Track Report',cpp:'Cadet Protection Report',contacts:'Member Contact Report'};
const TYPES = ['duty','qualifications','tracks','cpp','contacts'];
const DEFAULT_SETTINGS={unit:'PA-035',name:'Quakertown Composite Squadron',number:'904'};
const blankState=()=>({format:'squadron-resources-v1',datasets:{},updated:{},manualContacts:{},settings:{...DEFAULT_SETTINGS}});
/* Pennsylvania Wing units, from the pawg.cap.gov sitemap (November 2026). */
const PA_UNITS=[
 ['Wing & group headquarters',[['PA-001','Pennsylvania Wing Headquarters'],['PA-002','Group 1 Headquarters'],['PA-003','Group 2 Headquarters'],['PA-004','Group 3 Headquarters'],['PA-005','Group 4 Headquarters'],['PA-006','Group 5 Headquarters'],['PA-007','Group 6 Headquarters']]],
 ['Group 1 · Southwest',[['PA-025','Allegheny County Composite Squadron'],['PA-310','Beaver County Composite Squadron'],['PA-190','Butler Composite Squadron'],['PA-133','Golden Triangle Composite Squadron'],['PA-253','Jimmy Stewart Composite Squadron'],['PA-601','Washington Composite Squadron']]],
 ['Group 2 · South Central',[['PA-060','Capital City Composite Squadron'],['PA-045','Dauphin County Composite Squadron'],['PA-308','Gettysburg Composite Squadron'],['PA-010','Lancaster Composite Squadron'],['PA-265','Lebanon VFW Composite Squadron'],['PA-089','Reading Composite Squadron']]],
 ['Group 3 · Southeast',[['PA-080','Chester County Composite Squadron'],['PA-018','Gen Carl A Spaatz Composite Squadron'],['PA-105','Griffin Composite Squadron'],['PA-301','Liberty Composite Squadron'],['PA-214','Northeast Philadelphia Composite Squadron'],['PA-160','Willow Grove JRB Composite Squadron']]],
 ['Group 4 · Northeast',[['PA-303','Braden Composite Squadron'],['PA-146','Doylestown Composite Squadron'],['PA-201','Endless Mountains Composite Squadron'],['PA-296','Lehigh Valley Composite Squadron'],['PA-066','Luzerne County Composite Squadron'],['PA-292','Pocono Mountains Composite Squadron'],['PA-035','Quakertown Composite Squadron']]],
 ['Group 5 · Central',[['PA-288','Brush Mountain Composite Squadron'],['PA-258','Cambria County Composite Squadron'],['PA-522','Columbia County Composite Squadron'],['PA-338','Nittany Composite Squadron'],['PA-065','Piper Composite Squadron']]],
 ['Group 6 · Northwest',[['PA-125','Armstrong County Composite Squadron'],['PA-326','Clarion Composite Squadron'],['PA-503','Crawford County Composite Squadron'],['PA-009','Erie Composite Squadron'],['PA-337','Lawrence County Composite Squadron'],['PA-143','Major Don Beatty Composite Squadron'],['PA-505','Warren County Composite Squadron']]]];
const unitName=code=>{for(const[,list]of PA_UNITS)for(const[c,n]of list)if(c===code)return n;return '';};
const shortUnit=u=>{const m=String(u||'').toUpperCase().match(/([A-Z]{2}-\d{3})$/);return m?m[1]:String(u||'');};
let state=blankState();
try{const old=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(old&&old.format===state.format){state=old;state.manualContacts=state.manualContacts||{};state.updated=state.updated||{};state.settings={...DEFAULT_SETTINGS,...(state.settings||{})};}}catch(_e){}
let view='home', query='', memberID=null, pending=null, status='', statusError=false, filter='all', modalKind='';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const records=t=>(state.datasets[t]&&Array.isArray(state.datasets[t].records))?state.datasets[t].records:[];
const membersOf=t=>(state.datasets[t]&&Array.isArray(state.datasets[t].members))?state.datasets[t].members:[];
const date=t=>t?new Date(t+'T12:00:00'):null;
const pretty=t=>t?new Date(t+'T12:00:00').toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}):'Not supplied';
function statusFor(r){if(!r.expires)return {code:'current',label:'Current'};const delta=Math.floor((date(r.expires)-new Date())/86400000);if(delta<0)return {code:'expired',label:'Expired'};if(delta<=90)return {code:'soon',label:'Expires soon'};return {code:'current',label:'Current'};}
const CPP_WARN_DAYS=30;
function cppStatus(r){const rs=String(r.report_status||'').toUpperCase();
if(r.expires){const d=Math.floor((date(r.expires)-new Date())/86400000);
if(d<0||rs.startsWith('E'))return {code:'expired',label:'Expired',days:d};
if(d<=CPP_WARN_DAYS)return {code:'soon',label:d===0?'Expires today':d===1?'Expires tomorrow':'Expires in '+d+' days',days:d};
return {code:'current',label:'Current',days:d};}
if(rs.startsWith('E'))return {code:'expired',label:'Expired'};
if(rs.startsWith('O')||rs.startsWith('0'))return {code:'expired',label:'Not complete'};
if(rs.startsWith('C'))return {code:'current',label:'Current'};
const t=String(r.status_text||'').toLowerCase();
if(/expired|overdue|not complete|incomplete|missing|required/.test(t))return {code:'expired',label:r.status_text};
if(r.completed)return {code:'current',label:'Completed'};if(t)return {code:'unknown',label:r.status_text};return {code:'unknown',label:'No date'};}
const tagClass=code=>code==='expired'?'bad':code==='soon'?'warn':code==='current'?'good':'unknown';
const rankOf=code=>({expired:0,soon:1,unknown:2,current:3})[code]??2;
const tag=(label,type='')=>`<span class="tag ${type}">${esc(label)}</span>`;

/* ---------- CAP abbreviations people actually type ---------- */
const ABBR={
 mp:{label:'Mission Pilot',any:[['mission pilot']]},
 tmp:{label:'Transport Mission Pilot',any:[['transport mission pilot']]},
 cop:{label:'Cadet Orientation Pilot',any:[['orientation pilot']]},
 tp:{label:'Tow Pilot',any:[['tow pilot']]},
 ip:{label:'Instructor Pilot',any:[['instructor pilot']]},
 fro:{label:'Flight Release Officer',any:[['flight release']]},
 mo:{label:'Mission Observer',any:[['mission observer']]},
 ms:{label:'Mission Scanner',any:[['mission scanner']]},
 ap:{label:'Airborne Photographer',any:[['airborne photographer'],['aerial photographer']]},
 msa:{label:'Mission Staff Assistant',any:[['mission staff assistant']]},
 ges:{label:'General Emergency Services',any:[['general emergency services']]},
 gtm:{label:'Ground Team Member',any:[['ground team member']]},
 gtl:{label:'Ground Team Leader',any:[['ground team leader']]},
 udf:{label:'Urban Direction Finding Team',any:[['urban direction finding'],['urban df']]},
 mro:{label:'Mission Radio Operator',any:[['mission radio operator']]},
 rado:{label:'Radio Operator',any:[['radio operator']]},
 coml:{label:'Communications Unit Leader',any:[['communications unit leader'],['comm unit leader']],tokens:['cul']},
 cul:{label:'Communications Unit Leader',any:[['communications unit leader'],['comm unit leader']],tokens:['coml']},
 comt:{label:'Communications Technician',any:[['communications technician']]},
 icut:{label:'Introductory Communications User Training',any:[['introductory communications']]},
 bcut:{label:'Basic Communications User Training',any:[['basic communications user']]},
 fls:{label:'Flight Line Supervisor',any:[['flight line supervisor']]},
 flm:{label:'Flight Line Marshaller',any:[['flight line marshal']]},
 ic:{label:'Incident Commander',any:[['incident commander']]},
 osc:{label:'Operations Section Chief',any:[['operations section chief']]},
 psc:{label:'Planning Section Chief',any:[['planning section chief']]},
 lsc:{label:'Logistics Section Chief',any:[['logistics section chief']]},
 fasc:{label:'Finance/Admin Section Chief',any:[['finance','section chief']]},
 aobd:{label:'Air Operations Branch Director',any:[['air operations branch director']]},
 gbd:{label:'Ground Branch Director',any:[['ground branch director']]},
 mso:{label:'Mission Safety Officer',any:[['mission safety officer']]},
 pio:{label:'Public Information Officer',any:[['public information officer']]},
 lo:{label:'Liaison Officer',any:[['liaison officer']]},
 mc:{label:'Mission Chaplain',any:[['mission chaplain']]},
 cism:{label:'Critical Incident Stress Management',any:[['critical incident stress']]},
 suas:{short:'sUAS',label:'sUAS (small unmanned aircraft)',any:[['suas'],['unmanned']],tokens:['uas']},
 suasmp:{short:'sUAS MP',label:'sUAS Mission Pilot',any:[['suas','pilot'],['unmanned','pilot']]},
 suast:{short:'sUAS Tech',label:'sUAS Technician',any:[['suas','technician'],['unmanned','technician']],tokens:['uast']},
 uast:{label:'sUAS Technician',any:[['suas','technician']],tokens:['suast']},
 uao:{label:'Unit Alert Officer',any:[['unit alert officer']]},
 set:{label:'Skills Evaluator Training',any:[['skills evaluator']]},
 ops:{label:'OPSEC',any:[['opsec']]},
 cpp:{label:'Cadet Protection',any:[['cadet protection']],cpp:true,tokens:['cppt']},
 cppt:{label:'Cadet Protection',any:[['cadet protection']],cpp:true,tokens:['cpp']},
};
const TIP_KEYS=['mp','mo','ms','ap','gtm','gtl','udf','mro','rado','coml','ic','osc','psc','lsc','mso','pio','fls','flm','suasmp','cpp'];
function aliasFor(q){const k=String(q||'').toLowerCase().replace(/[^a-z0-9]/g,'');const m=k.match(/^([a-z]+)\d?$/);if(!m||!ABBR[m[1]])return null;return {key:m[1],...ABBR[m[1]]};}
function aliasMatches(alias,name){const n=String(name||'').toLowerCase();
/* eServices names often start with a code ("MP - SAR/DR Mission Pilot", "GTM3 - ..."): match the code exactly so MP does not also return TMP. */
const pre=n.match(/^([a-z0-9./]+) - /);if(pre){const code=pre[1].replace(/\d+$/,'');return [alias.key,...(alias.tokens||[])].includes(code);}
if(alias.any.some(group=>group.every(t=>n.includes(t))))return true;
return [alias.key,...(alias.tokens||[])].some(t=>new RegExp('(^|[^a-z])'+t+'\\d?($|[^a-z])','i').test(n));}

function byPerson(){const map=new Map();for(const type of ['duty','qualifications','tracks','cpp','contacts'])for(const m of membersOf(type)){
const id=String(m.capid||'');if(!/^\d{6}$/.test(id))continue;
const cur=map.get(id)||{capid:id,name:'',rank:''};if(m.name&&(!cur.name||type==='duty'))cur.name=m.name;if(m.rank&&(!cur.rank||type==='duty'))cur.rank=m.rank;map.set(id,cur);
}return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));}
const peopleMap=()=>new Map(byPerson().map(m=>[m.capid,m]));
function qsMatches(...strings){return !query||strings.some(s=>String(s??'').toLowerCase().includes(query.toLowerCase()));}
function notice(msg,error=false){status=msg;statusError=error;renderNotice();}
function renderNotice(){$('#feedback').innerHTML=status?`<div class="notice ${statusError?'error':'ok'}">${esc(status)}</div>`:'';}
function switchView(to){view=to;memberID=null;query='';filter='all';render();window.scrollTo(0,0);}
function searchBar(placeholder){return `<div class="controls"><input id="search" class="search" type="search" value="${esc(query)}" placeholder="${esc(placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false" /></div>`;}
function tips(){return `<details class="tips"><summary>Search by abbreviation (MP, AP, GTM, IC…)</summary><div class="chips">${TIP_KEYS.map(k=>`<button class="chip" data-q="${k}" title="${esc(ABBR[k].label)}">${esc(ABBR[k].short||k.toUpperCase())}</button>`).join('')}</div><p class="helper">Type an abbreviation to see what it stands for and who in the squadron holds it. Spaces and dashes are ignored, so “sUAS MP” works too.</p></details>`;}
function attachSearch(){const inp=$('#search');if(inp){inp.addEventListener('input',e=>{query=e.target.value;renderContent();const next=$('#search');if(next){next.focus();next.setSelectionRange(query.length,query.length);}});}}
function empty(title,desc,showImport=true){return `<div class="panel empty"><div class="illustration">◇</div><strong>${esc(title)}</strong><p>${esc(desc)}</p>${showImport?'<button class="btn" data-view="import">Update reports</button>':''}</div>`;}
function emptyInline(s){return `<p class="subtle">${esc(s)}</p>`;}
const record=(title,subtitle,right)=>`<div class="record"><div class="left"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></div><div class="right">${right}</div></div>`;
const assignLabel=t=>t==='P'?'Primary':t==='A'?'Assistant':t==='T'?'Temporary':t;

/* ---------- Who holds a qualification ---------- */
function qualGroups(test){const groups={};for(const r of records('qualifications'))if(test(r.qualification))(groups[r.qualification]??=[]).push(r);
return Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0]));}
function holderRow(r,people,st){const m=people.get(r.capid);return `<button class="record linkrow" data-member="${esc(r.capid)}"><div class="left"><strong>${nameTag(r.capid,m?.name||r.capid)}</strong><small>${esc(m?.rank||'')} · CAPID ${esc(r.capid)}${r.expires?' · Expires '+pretty(r.expires):''}</small></div><div class="right">${tag(st.label,tagClass(st.code))}</div></button>`;}
function holderGroups(groups,people){return groups.map(([q,rs])=>{const sorted=rs.slice().sort((a,b)=>rankOf(statusFor(b).code)-rankOf(statusFor(a).code)||(people.get(a.capid)?.name||'').localeCompare(people.get(b.capid)?.name||''));
const cur=rs.filter(r=>statusFor(r).code!=='expired').length;
return `<div class="group"><h3>${esc(q)} ${tag(cur+' current','good')}${rs.length-cur?' '+tag((rs.length-cur)+' expired','bad'):''}</h3>${sorted.map(r=>holderRow(r,people,statusFor(r))).join('')}</div>`;}).join('');}
function aliasBanner(a,count){return `<div class="alias"><span class="abbr">${esc(a.short||a.key.toUpperCase())}</span><div><strong>${esc(a.label)}</strong><small>${count} member${count===1?'':'s'} in the imported reports</small></div></div>`;}
function latestCpp(){const out=new Map();for(const r of records('cpp')){const cur=out.get(r.capid);const key=x=>String(x.expires||x.completed||'');if(!cur||key(r)>key(cur))out.set(r.capid,r);}return out;}
let cppCache=null;
function cppNow(){if(!cppCache){cppCache=new Map();for(const r of latestCpp().values())cppCache.set(r.capid,cppStatus(r));}return cppCache;}
/* Red = cadet protection expired, yellow = expires within 30 days. */
function nameTag(capid,name){const st=cppNow().get(capid);const cls=st?.code==='expired'?' bad':st?.code==='soon'?' warn':'';
return cls?`<span class="nm${cls}" title="Cadet protection: ${esc(st.label)}">${esc(name)}</span>`:esc(name);}
function cppHolders(people){return [...latestCpp().values()].sort((a,b)=>rankOf(cppStatus(b).code)-rankOf(cppStatus(a).code)).map(r=>holderRow(r,people,cppStatus(r))).join('');}

/* ---------- Contacts ---------- */
const digitsOf=s=>String(s||'').replace(/[^\d+]/g,'').replace(/(?!^)\+/g,'');
const prettyPhone=d=>{const x=d.replace(/^\+?1(?=\d{10}$)/,'');return /^\d{10}$/.test(x)?`(${x.slice(0,3)}) ${x.slice(3,6)}-${x.slice(6)}`:d;};
const EMAIL_RX=/^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
function contactFor(id){const imp=records('contacts').find(r=>r.capid===id)||{phones:[],emails:[]};const man=state.manualContacts[id]||{};
const phones=[],emails=[],seen=new Set();
if(man.phone){const d=digitsOf(man.phone);phones.push({label:'Saved in this app',value:prettyPhone(d),digits:d});seen.add(d.slice(-10));}
for(const p of imp.phones||[]){const d=digitsOf(p.digits||p.value);if(!d||seen.has(d.slice(-10)))continue;seen.add(d.slice(-10));phones.push({label:p.label||'Phone',value:p.value||prettyPhone(d),digits:d});}
if(man.email&&EMAIL_RX.test(man.email)){emails.push({label:'Saved in this app',value:man.email});seen.add(man.email.toLowerCase());}
for(const e of imp.emails||[]){if(!EMAIL_RX.test(e.value||'')||seen.has(e.value.toLowerCase()))continue;seen.add(e.value.toLowerCase());emails.push(e);}
for(const r of records('cpp'))if(r.capid===id&&EMAIL_RX.test(r.email||'')&&!seen.has(r.email.toLowerCase())){seen.add(r.email.toLowerCase());emails.push({label:'Email (cadet protection report)',value:r.email});}
return {phones,emails};}
function contactPanel(id){const c=contactFor(id);
const rows=[...c.phones.map(p=>`<a class="contact" href="tel:${esc(p.digits)}"><span class="ic" aria-hidden="true">☎</span><span class="ct"><strong>${esc(p.value)}</strong><small>${esc(p.label)} · tap to call</small></span><span class="chevron">›</span></a>`),
...c.emails.map(e=>`<a class="contact" href="mailto:${esc(e.value)}"><span class="ic" aria-hidden="true">✉</span><span class="ct"><strong>${esc(e.value)}</strong><small>${esc(e.label)} · tap to email</small></span><span class="chevron">›</span></a>`)].join('');
return `<div class="panel"><h2>Contact</h2>${rows||emptyInline('No phone or email on file. Import the Contact Report or add them here.')}<div style="height:8px"></div><button class="btn secondary" id="editContact">${state.manualContacts[id]?'Edit saved contact':'Add phone / email'}</button></div>`;}

function cppDetail(r){const st=cppStatus(r);const mark=v=>String(v||'').toUpperCase()==='X'?'✓':v?'✗':'—';const bgc={A:'Approved',P:'Pending','N/A':'N/A'}[r.bgc]||r.bgc;
const lines=[r.member_type||'',r.completed?'Last course '+pretty(r.completed):'',r.expires?'Renews '+pretty(r.expires)+(r.basis?' ('+r.basis.toLowerCase()+')':''):(r.youth_cadet?'Cadet: status taken from the report':'')].filter(Boolean).join(' · ')||r.status_text||'No dates in report';
const more=[r.basic?'Basic '+pretty(r.basic):'',r.advanced?'Advanced '+pretty(r.advanced):'',r.cadet_course?'Cadet course '+pretty(r.cadet_course):'',r.quiz!==undefined&&r.quiz!==''?'Quiz '+mark(r.quiz):'',r.conversation?'Conversation '+mark(r.conversation):'',bgc?'Background check '+bgc:''].filter(Boolean).join(' · ');
return `<div class="record"><div class="left"><strong>${esc(r.course||'Cadet Protection')}</strong><small>${esc(lines)}</small>${more?`<small>${esc(more)}</small>`:''}</div><div class="right">${tag(st.label,tagClass(st.code))}</div></div>`;}
function profile(id){const m=byPerson().find(x=>x.capid===id);if(!m)return empty('Member not found','Import updated reports to refresh your member list.');
const duty=records('duty').filter(r=>r.capid===id), quals=records('qualifications').filter(r=>r.capid===id), tracks=records('tracks').filter(r=>r.capid===id), cpp=records('cpp').filter(r=>r.capid===id);
return `<div class="panel"><button class="btn secondary" id="backMember">← Members</button><h2 style="margin:18px 0 4px">${nameTag(m.capid,m.name)}</h2><div class="subtle">${m.rank?esc(m.rank)+' · ':''}CAPID ${esc(m.capid)}</div><p>${duty.length} duty assignments · ${quals.length} qualification entries · ${tracks.length} track ratings</p></div>
${contactPanel(id)}
<div class="panel"><h2>Duty assignments</h2>${duty.length?duty.map(r=>record(r.duty,r.section||'',tag(assignLabel(r.assignment_type)))).join(''):emptyInline('No assigned duties in the imported report.')}</div>
<div class="panel"><h2>Cadet protection</h2>${cpp.length?cpp.map(cppDetail).join(''):emptyInline(records('cpp').length?'Not listed in the imported Cadet Protection report.':'Cadet Protection report not imported yet.')}</div>
<div class="panel"><h2>Qualifications</h2>${quals.length?quals.sort((a,b)=>a.qualification.localeCompare(b.qualification)).map(r=>{const st=statusFor(r);return record(r.qualification,r.expires?'Expires '+pretty(r.expires):r.expiration_text||'Does not expire',tag(st.label,tagClass(st.code)));}).join(''):emptyInline('No qualifications in the imported report.')}</div>
<div class="panel"><h2>Specialty tracks</h2>${tracks.length?tracks.map(r=>record(r.track,r.completed?'Completed '+pretty(r.completed):'Date not supplied',tag(r.level))).join(''):emptyInline('No specialty track records found.')}</div>`;
}
function home(){const count=byPerson().length,exp=records('qualifications').filter(x=>statusFor(x).code==='expired').length;
return `<div class="stats"><div class="stat"><label>Known members</label><strong>${count}</strong><small>Across imported reports</small></div><div class="stat"><label>Duty assignments</label><strong>${records('duty').length}</strong><small>Current imported file</small></div><div class="stat"><label>Qualifications</label><strong>${records('qualifications').length}</strong><small>Achievement entries</small></div><div class="stat"><label>Expired entries</label><strong>${exp}</strong><small>Not counted as current</small></div></div>
<div class="panel"><h2>Find a resource</h2>${searchBar('Name, CAPID, qualification, MP, AP, or duty')}${query?'':tips()}<div id="homeSearch"></div></div>
<div class="panel"><h2>Quick lookup</h2><div class="shortcuts"><button data-view="members">Members<small>View a member's complete profile</small></button><button data-view="qualifications">Qualifications<small>Find qualified personnel</small></button><button data-view="duties">Duty assignments<small>Who is responsible for what?</small></button><button data-view="tracks">Specialty tracks<small>Technician, Senior and Master</small></button><button data-view="cpp">Cadet protection<small>Training status and renewals</small></button><button data-view="expiring">Expiring soon<small>Monitor qualification renewal</small></button><button data-view="import">Update reports<small>Replace the CAP reports</small></button><button data-view="import" data-scroll="backups">Secure backup<small>PIN-protected export</small></button><button data-view="settings">Settings<small>Choose your squadron</small></button></div></div>
${!count?empty('No reports loaded','Import the CAP eServices files, or restore your starter backup.'):''}<div class="panel"><h2>Report dates</h2>${TYPES.map(t=>`<div class="record"><div class="left"><strong>${esc(names[t])}</strong><small>${state.updated[t]?'Imported '+new Date(state.updated[t]).toLocaleString():'Not imported'}</small></div><div class="right">${tag(records(t).length+' records')}</div></div>`).join('')}</div>`;
}
function homeSearch(){const box=$('#homeSearch');if(!box)return;if(!query.trim()){box.innerHTML='';return;}
const people=peopleMap();const a=aliasFor(query);let html='';
if(a){if(a.cpp){const n=latestCpp().size;html+=aliasBanner(a,n)+(n?`<div class="group"><h3>Cadet Protection report</h3>${cppHolders(people)}</div>`:emptyInline('Cadet Protection report not imported yet.'));}
else{const groups=qualGroups(n=>aliasMatches(a,n));const holders=new Set(groups.flatMap(([,rs])=>rs.map(r=>r.capid)));
html+=aliasBanner(a,holders.size)+(groups.length?holderGroups(groups,people):emptyInline('No one in the imported qualification report holds '+a.label+'.'));}}
const matchPeople=byPerson().filter(m=>qsMatches(m.name,m.capid,m.rank)).slice(0,10);
if(matchPeople.length)html+=(a?`<div class="section-title">Members matching “${esc(query)}”</div>`:'')+matchPeople.map(m=>`<button class="person" data-member="${esc(m.capid)}"><div class="main"><strong>${nameTag(m.capid,m.name)}</strong><small>${esc(m.rank)} · ${esc(m.capid)}</small></div><span class="chevron">›</span></button>`).join('');
if(!a&&query.trim().length>=2){const groups=qualGroups(n=>qsMatches(n)).slice(0,6);if(groups.length)html+=`<div class="section-title">Qualified members</div>`+holderGroups(groups,people);
const dg={};for(const r of records('duty'))if(qsMatches(r.duty))(dg[r.duty]??=[]).push(r);const dl=Object.entries(dg).slice(0,5);
if(dl.length)html+=`<div class="section-title">Duty positions</div>`+dl.map(([d,rs])=>`<div class="group"><h3>${esc(d)}</h3>${rs.map(r=>`<button class="record linkrow" data-member="${esc(r.capid)}"><div class="left"><strong>${nameTag(r.capid,people.get(r.capid)?.name||r.capid)}</strong><small>${esc(r.section||'')}</small></div><div class="right">${tag(assignLabel(r.assignment_type))}</div></button>`).join('')}</div>`).join('');}
box.innerHTML=html||emptyInline('No matching records.');
box.querySelectorAll('[data-member]').forEach(b=>b.addEventListener('click',()=>openMember(b.dataset.member)));
}
function members(){if(memberID)return profile(memberID);const a=aliasFor(query);let all,extra=new Map(),banner='';
if(a){const st=new Map();if(a.cpp){for(const r of latestCpp().values())st.set(r.capid,cppStatus(r));}
else for(const r of records('qualifications'))if(aliasMatches(a,r.qualification)){const s=statusFor(r),cur=st.get(r.capid);if(!cur||rankOf(s.code)>rankOf(cur.code))st.set(r.capid,s);}
all=byPerson().filter(m=>st.has(m.capid));extra=st;banner=aliasBanner(a,all.length);}
else all=byPerson().filter(m=>qsMatches(m.name,m.capid,m.rank));
return `${searchBar('Search name, CAPID, rank, or MP / AP / GTM…')}${banner}<div class="count">${all.length} members</div><div class="list grid">${all.map(m=>`<button class="person" data-member="${esc(m.capid)}"><div class="avatar">${esc((m.name||'?').trim().charAt(0).toUpperCase())}</div><div class="main"><strong>${nameTag(m.capid,m.name||'Unnamed Member')}</strong><small>${esc(m.rank)} · CAPID ${esc(m.capid)}</small></div>${extra.has(m.capid)?tag(extra.get(m.capid).label,tagClass(extra.get(m.capid).code)):'<span class="chevron">›</span>'}</button>`).join('')}</div>${all.length?'':empty('No members','Import reports or change your search.')}`;}
function duties(){const people=peopleMap();const rows=records('duty').filter(r=>qsMatches(r.duty,r.section,people.get(r.capid)?.name));
const groups={};for(const r of rows)(groups[r.duty]??=[]).push(r);
return `${searchBar('Find a duty or assigned member')}<div class="count">${Object.keys(groups).length} duty positions · ${rows.length} assignments</div>
${Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([d,rs])=>`<div class="panel"><h2>${esc(d)}</h2>${rs.map(r=>`<button class="record linkrow" data-member="${esc(r.capid)}"><div class="left"><strong>${nameTag(r.capid,people.get(r.capid)?.name||r.capid)}</strong><small>${esc(r.section)} · ${esc(people.get(r.capid)?.rank||'')} · ${esc(r.capid)}${r.removed?' · Term ends '+pretty(r.removed):''}</small></div><div class="right">${tag(assignLabel(r.assignment_type))}</div></button>`).join('')}</div>`).join('')}${rows.length?'':empty('No duty assignments','Import the Duty Assignment Report or change your search.')}`;}
function qualifications(){const rows=records('qualifications'), groups={};const people=peopleMap();const a=aliasFor(query);
for(const r of rows) {const st=statusFor(r);if(filter==='current' && st.code==='expired')continue;if(filter==='expired' && st.code!=='expired')continue;if(filter==='soon' && st.code!=='soon')continue;
if(a?!aliasMatches(a,r.qualification):!qsMatches(r.qualification,people.get(r.capid)?.name,r.capid))continue;(groups[r.qualification]??=[]).push(r);}
const holders=new Set(Object.values(groups).flat().map(r=>r.capid));
return `${searchBar('Qualification, member, CAPID, or MP / AP…')}${query?'':tips()}<div class="controls"><select id="qualFilter"><option value="all" ${filter==='all'?'selected':''}>All statuses</option><option value="current" ${filter==='current'?'selected':''}>Not expired</option><option value="soon" ${filter==='soon'?'selected':''}>Expiring within 90 days</option><option value="expired" ${filter==='expired'?'selected':''}>Expired</option></select></div>${a?aliasBanner(a,holders.size):''}<div class="count">${Object.keys(groups).length} qualifications</div>
${Object.entries(groups).sort((x,y)=>x[0].localeCompare(y[0])).map(([q,rs])=>`<div class="panel"><h2>${esc(q)} <span class="tag">${rs.length}</span></h2>${rs.sort((x,y)=>(people.get(x.capid)?.name||'').localeCompare(people.get(y.capid)?.name||'')).map(r=>holderRow(r,people,statusFor(r))).join('')}</div>`).join('')}${Object.keys(groups).length?'':empty('No matching qualifications','Import the All Qualification Listing or change the filters.')}`;}
function tracks(){const groups={};const people=peopleMap();for(const r of records('tracks'))if(qsMatches(r.track,r.level,people.get(r.capid)?.name,r.capid))(groups[r.track]??=[]).push(r);
return `${searchBar('Search track, rating, or member')}<div class="count">${Object.keys(groups).length} specialty tracks</div>${Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([t,rows])=>`<div class="panel"><h2>${esc(t)}</h2>${rows.map(r=>`<button class="record linkrow" data-member="${esc(r.capid)}"><div class="left"><strong>${nameTag(r.capid,people.get(r.capid)?.name||r.capid)}</strong><small>${esc(people.get(r.capid)?.rank||'')} · CAPID ${esc(r.capid)} · ${r.completed?pretty(r.completed):'Date not supplied'}</small></div><div class="right">${tag(r.level)}</div></button>`).join('')}</div>`).join('')}${Object.keys(groups).length?'':empty('No specialty tracks','Import the specialty track ZIP or change your search.')}`;}
function cppReportLine(){const d=state.datasets.cpp;if(!d)return '';return `<p class="helper">${d.unit?esc(d.unit)+' · ':''}Report imported ${state.updated.cpp?new Date(state.updated.cpp).toLocaleDateString():''}. Adult training renews 12 months after the most recent Basic or Advanced course; cadet status comes from the report.</p>`;}
function cpp(){if(!records('cpp').length)return empty('Cadet Protection report not imported','Import the Cadet Protection report from Update Reports to track completions and renewals.');
const people=peopleMap();const all=[...latestCpp().values()];
const latest=all.filter(r=>{const st=cppStatus(r);if(filter==='current'&&st.code==='expired')return false;if(filter==='expired'&&st.code!=='expired')return false;if(filter==='soon'&&st.code!=='soon')return false;return qsMatches(people.get(r.capid)?.name,r.capid,r.course,r.status_text);})
.sort((a,b)=>rankOf(cppStatus(a).code)-rankOf(cppStatus(b).code)||String(a.expires||'').localeCompare(String(b.expires||''))||(people.get(a.capid)?.name||'').localeCompare(people.get(b.capid)?.name||''));
const counts={expired:0,soon:0,current:0,unknown:0};for(const r of all)counts[cppStatus(r).code]++;
const listed=new Set(all.map(r=>r.capid));const missing=membersOf('duty').filter(m=>!listed.has(m.capid));const missingShown=missing.filter(m=>qsMatches(m.name,m.capid));
return `<div class="stats"><div class="stat"><label>Current</label><strong>${counts.current}</strong><small>Completed / not expired</small></div><div class="stat"><label>Expiring ≤ 30 days</label><strong>${counts.soon}</strong><small>Highlighted yellow</small></div><div class="stat"><label>Expired / incomplete</label><strong>${counts.expired}</strong><small>Highlighted red</small></div><div class="stat"><label>Not on report</label><strong>${missing.length}</strong><small>Assigned members not listed</small></div></div>
${searchBar('Search member or CAPID')}<div class="controls"><select id="qualFilter"><option value="all" ${filter==='all'?'selected':''}>All statuses</option><option value="current" ${filter==='current'?'selected':''}>Not expired</option><option value="soon" ${filter==='soon'?'selected':''}>Expiring within 30 days</option><option value="expired" ${filter==='expired'?'selected':''}>Expired / incomplete</option></select></div>
<div class="legend"><span class="nm bad">Name</span> expired or incomplete <span class="nm warn">Name</span> expires within 30 days</div>${cppReportLine()}
<div class="panel"><h2>Training status</h2>${latest.length?latest.map(r=>{const st=cppStatus(r),m=people.get(r.capid);return `<button class="record linkrow" data-member="${esc(r.capid)}"><div class="left"><strong>${nameTag(r.capid,m?.name||r.capid)}</strong><small>${esc(r.member_type||m?.rank||'')} · CAPID ${esc(r.capid)}${r.completed?' · Last course '+pretty(r.completed):''}${r.expires?' · Renews '+pretty(r.expires):''}</small></div><div class="right">${tag(st.label,tagClass(st.code))}</div></button>`;}).join(''):emptyInline('No matching records.')}</div>
${missingShown.length&&filter==='all'?`<div class="panel"><h2>Not in the Cadet Protection report</h2><p class="subtle">These members hold duty assignments but don't appear in the imported report. Some may not be required to complete it.</p>${missingShown.map(m=>`<button class="record linkrow" data-member="${esc(m.capid)}"><div class="left"><strong>${esc(m.name)}</strong><small>${esc(m.rank)} · CAPID ${esc(m.capid)}</small></div><div class="right">${tag('Not listed','unknown')}</div></button>`).join('')}</div>`:''}`;}
function expiring(){const people=peopleMap();
const rows=[...records('qualifications').map(r=>({r,what:r.qualification,st:statusFor(r),src:''})),...[...latestCpp().values()].map(r=>({r,what:r.course||'Cadet Protection',st:cppStatus(r),src:'CPP'}))]
.filter(x=>['expired','soon'].includes(x.st.code)).sort((a,b)=>String(a.r.expires||'').localeCompare(String(b.r.expires||''))).filter(x=>qsMatches(x.what,people.get(x.r.capid)?.name,x.r.capid));
return `${searchBar('Search expired or upcoming entries')}<div class="count">${rows.length} entries expired or expiring soon (qualifications: 90 days · cadet protection: 30 days)</div><div class="panel"><h2>Renewal watch</h2>${rows.length?rows.map(({r,what,st,src})=>`<button class="record linkrow" data-member="${esc(r.capid)}"><div class="left"><strong>${esc(what)}</strong><small>${nameTag(r.capid,people.get(r.capid)?.name||r.capid)} · ${esc(r.capid)}${r.expires?' · Expires '+pretty(r.expires):''}</small></div><div class="right">${src?tag(src)+' ':''}${tag(st.label,tagClass(st.code))}</div></button>`).join(''):emptyInline('No expiring or expired entries in the imported data.')}</div>`;}
function imports(){const pdf=isNative()?' (PDF also accepted)':'';const cards=[['duty','Duty_Assignment.xlsx','Excel'+pdf+' · duty positions, members, P/A/T designation','Duty Assignment'],['qualifications','All_Qual_Achv_with_data.xlsx','Excel'+pdf+' · qualifications, completions, expirations','Qualification'],['tracks','Specialty_Track_Report.xlsx.zip','ZIP or Excel · specialty tracks and ratings. Member emails are read too, plus phones if the Contact Report inside has any.','Specialty Track'],['cpp','Cadet_Protection_Course_Completion_Report.xlsx','Excel or CSV · training completion and renewal by CAPID','Cadet Protection'],['contacts','Contact Report','Excel or CSV · phone numbers and email addresses by CAPID','Contact']];
return `<div class="panel"><h2>How updates work</h2><p>Download these reports for ${esc(state.settings.unit)} from CAP eServices. Tap the matching button, select the saved file, review the preview and apply it. Each category can be updated independently.</p><p class="subtle">No login or server is used. Files are read directly on this phone. The original files are not kept inside the app. You can use any import button: the app recognizes which report you picked.</p></div>
${cards.map(([t,file,desc,btn])=>`<div class="import-card"><h3>${esc(names[t])}</h3><div class="desc">${esc(desc)}</div><div class="meta">Report: ${esc(file)}<br>${records(t).length} records · ${state.updated[t]?new Date(state.updated[t]).toLocaleString():'Not imported'}</div><button class="btn" data-import="${t}">Select ${esc(btn)} report</button></div>`).join('')}
<div class="panel" id="backups"><h2>Backups</h2><p>A <strong>secure backup</strong> is encrypted on this phone with a PIN you choose (AES-256). The file can be stored in Drive or Downloads, but it can only be opened in this app with that PIN. There is no way to recover a lost PIN.</p><button class="btn full" id="saveSecure">Export secure backup (PIN)</button><div style="height:8px"></div><div class="btnrow"><button class="btn secondary" id="openBackup">Restore backup</button><button class="btn secondary" id="saveBackup">Unprotected export</button></div><div style="height:10px"></div><button class="btn danger full" id="deleteData">Delete all local data</button><p class="helper">Deleting the app also removes its local records. Export a secure backup first.</p></div>`;
}
function settings(){const cur=state.settings;const known=!!unitName(cur.unit);
return `<div class="panel"><h2>Squadron</h2><p class="subtle">Choose your unit. The name and charter number appear at the top of every screen and on the Update Reports page.</p>
<label class="field">Pennsylvania Wing unit<select class="search" id="unitSel">${PA_UNITS.map(([g,list])=>`<optgroup label="${esc(g)}">${list.map(([c,n])=>`<option value="${c}" ${c===cur.unit?'selected':''}>${esc(n)} (${c})</option>`).join('')}</optgroup>`).join('')}<option value="__other" ${known?'':'selected'}>Other unit (enter below)</option></select></label>
<label class="field">Charter number<input class="search" id="unitCode" value="${esc(cur.unit)}" placeholder="PA-035" autocapitalize="characters" autocomplete="off"></label>
<label class="field">Squadron name<input class="search" id="unitName" value="${esc(cur.name)}" autocomplete="off"></label>
<label class="field">Squadron number (optional)<input class="search" id="unitNum" value="${esc(cur.number)}" inputmode="numeric" placeholder="e.g. 904" autocomplete="off"></label>
<div class="preview"><small>Header preview</small><strong id="pvName">${esc(cur.name)}${cur.number?' '+esc(cur.number):''}</strong><span id="pvUnit">${esc(cur.unit)} · LOCAL RESOURCE LOOKUP</span></div>
<div id="setMsg"></div><div class="btnrow"><button class="btn" id="saveSettings">Save</button></div>
<p class="helper">Unit list from the Pennsylvania Wing website (pawg.cap.gov), November 2026. Pick “Other” for a new unit or another wing.</p></div>`;}
function openMember(id){memberID=id;view='members';query='';render();window.scrollTo(0,0);}
function renderContent(){cppCache=null;const content=$('#content');content.innerHTML=({home,members,duties,qualifications,tracks,cpp,expiring,import:imports,settings})[view]();
attachSearch();if(view==='home')homeSearch();
content.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{switchView(b.dataset.view);if(b.dataset.scroll)$('#'+b.dataset.scroll)?.scrollIntoView();}));
content.querySelectorAll('#content > * [data-member], #content > [data-member]').forEach(b=>{if(!b.closest('#homeSearch'))b.addEventListener('click',()=>openMember(b.dataset.member));});
content.querySelectorAll('[data-q]').forEach(b=>b.addEventListener('click',()=>{query=b.dataset.q.toUpperCase();renderContent();}));
const back=$('#backMember');if(back)back.onclick=()=>{memberID=null;render();};
const ec=$('#editContact');if(ec)ec.onclick=()=>editContact(memberID);
content.querySelectorAll('[data-import]').forEach(b=>b.addEventListener('click',()=>selectFile(b.dataset.import)));
const sel=$('#qualFilter');if(sel)sel.onchange=e=>{filter=e.target.value;renderContent()};
const secure=$('#saveSecure');if(secure)secure.onclick=securePinModal;
const us=$('#unitSel');if(us){const pv=()=>{$('#pvName').textContent=$('#unitName').value.trim()+($('#unitNum').value.trim()?' '+$('#unitNum').value.trim():'');$('#pvUnit').textContent=($('#unitCode').value.trim().toUpperCase()||'—')+' · LOCAL RESOURCE LOOKUP';};
us.onchange=()=>{if(us.value!=='__other'){$('#unitCode').value=us.value;$('#unitName').value=unitName(us.value);if(us.value!==state.settings.unit)$('#unitNum').value='';}else{$('#unitCode').value='';$('#unitName').value='';$('#unitNum').value='';$('#unitCode').focus();}pv();};
for(const id of ['#unitCode','#unitName','#unitNum'])$(id).addEventListener('input',pv);
$('#saveSettings').onclick=()=>{const code=$('#unitCode').value.trim().toUpperCase(),name=$('#unitName').value.trim(),num=$('#unitNum').value.trim();
if(!/^[A-Z]{2}-\d{3}$/.test(code)){$('#setMsg').innerHTML='<div class="notice error">Charter number should look like PA-035.</div>';return;}
if(!name){$('#setMsg').innerHTML='<div class="notice error">Enter the squadron name.</div>';return;}
if(num&&!/^[A-Za-z0-9 -]{1,12}$/.test(num)){$('#setMsg').innerHTML='<div class="notice error">Squadron number should be short, like 904.</div>';return;}
state.settings={unit:code,name,number:num};persist();applyBranding();notice('Squadron settings saved.');render();};}
const save=$('#saveBackup');if(save)save.onclick=()=>{
showModal(`<h2>Unprotected export?</h2><p class="subtle">This file is plain text. Anyone who gets it — from Drive, email, or a lost phone — can read every member's information. Use a secure backup unless you have a specific reason not to.</p><div class="btnrow"><button class="btn secondary" id="cancelModal">Cancel</button><button class="btn danger" id="confirmPlain">Export anyway</button></div>`,()=>{$('#confirmPlain').onclick=()=>{closeModal();if(isNative())window.Device.exportBackup(JSON.stringify(state));else offerFile('SquadronResources-Backup-UNPROTECTED-'+todayStamp()+'.json',JSON.stringify(state));};});};
const open=$('#openBackup');if(open)open.onclick=()=>{if(isNative())return window.Device.restoreBackup();pickFile('.json,application/json,text/plain',async f=>{const text=await f.text();if(WebCrypt.isEncrypted(text)){webSealed=text;window.onEncryptedBackup();}else window.onBackupImported(text);});};
const del=$('#deleteData');if(del)del.onclick=()=>showModal(`<h2>Delete local data?</h2><p class="subtle">This clears all imported records and saved contacts from the device. You will need to import reports or restore a backup to use the app again.</p><div class="btnrow"><button class="btn secondary" id="cancelModal">Cancel</button><button class="btn danger" id="confirmClear">Delete all records</button></div>`,()=>{$('#confirmClear').onclick=()=>{const keep=state.settings;state=blankState();state.settings=keep;persist();closeModal();notice('All locally stored reports have been removed.');render();};});
}
function applyBranding(){const s=state.settings||DEFAULT_SETTINGS;$('#brandSub').textContent=s.name+(s.number?' '+s.number:'');$('#eyebrow').textContent=s.unit+' · LOCAL RESOURCE LOOKUP';}
function render(){applyBranding();const titles={settings:['Settings','Choose your squadron and how it appears in the app.'],home:['Resource overview','Duty assignments, qualifications, specialty tracks, and cadet protection in one place.'],members:[memberID?'Member profile':'Member directory','Search by name, rank, CAPID, or qualification abbreviation.'],duties:['Duty assignments','See who holds each squadron responsibility.'],qualifications:['Qualification lookup','Find qualified personnel and check expiration dates.'],tracks:['Specialty track ratings','Technician, Senior, and Master progress.'],cpp:['Cadet protection','Red names are expired; yellow names expire within 30 days.'],expiring:['Renewal watch','Qualifications (90 days) and cadet protection (30 days) expiring soon or already expired.'],import:['Update CAP reports','Refresh your records right from this phone.']};
$('#heading').textContent=titles[view][0];$('#subtitle').textContent=titles[view][1];
document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));renderNotice();renderContent();}
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){notice('Device storage is full. Export a backup and free space.',true);}}
function showModal(html,onReady,kind=''){modalKind=kind;$('#modalContent').innerHTML=html;$('#modalBackdrop').classList.remove('hidden');$('#cancelModal')?.addEventListener('click',closeModal);if(onReady)onReady();}
function closeModal(){if(modalKind==='decrypt'){if(isNative())window.Device.cancelEncryptedRestore();else webSealed=null;}modalKind='';$('#modalBackdrop').classList.add('hidden');$('#modalContent').innerHTML='';pending=null;}
function pickFile(accept,cb){const i=document.createElement('input');i.type='file';i.accept=accept;i.style.display='none';i.addEventListener('change',()=>{const f=i.files&&i.files[0];i.remove();if(f)cb(f);});document.body.appendChild(i);i.click();}
function selectFile(type){pending={type};
if(isNative()){notice('Choose your downloaded '+names[type]+' file.');window.Device.chooseReport(type);return;}
pickFile('.xlsx,.zip,.csv,application/zip,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',async f=>{
if(f.size>15000000)return notice('File exceeds the 15 MB import limit.',true);
notice('Reading '+f.name+' on this phone…');try{importBytes(type,f.name,new Uint8Array(await f.arrayBuffer()));}catch(e){notice('Import failed: '+e.message,true);}});}
function importBytes(type,name,bytes){try{const data=window.Parsers.parse(bytes,name,type);
const note=data.type!==type?`That file is the ${names[data.type]}, so it was read as that report.`:'';pending={type:data.type,note};window.onReportImported(JSON.stringify(data));}
catch(e){pending=null;notice('Import failed: '+e.message,true);}}
/* Android APK: Java hands over non-PDF files so the same JavaScript readers are used everywhere. */
window.onFileBytes=raw=>{try{const o=JSON.parse(raw);const bin=atob(o.b64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);importBytes(o.type,o.name||'',u);}catch(e){notice('Import failed: '+e.message,true);}};

/* ---------- Manual contact entry ---------- */
function editContact(id){const cur=state.manualContacts[id]||{};const m=byPerson().find(x=>x.capid===id);
showModal(`<h2>Contact for ${esc(m?.name||id)}</h2><p class="subtle">Saved only in this app on this phone. Leave a field blank to remove it. Imported Contact Report details are kept separately.</p>
<label class="field">Phone<input class="search" id="cPhone" type="tel" inputmode="tel" autocomplete="off" value="${esc(cur.phone||'')}" placeholder="(610) 555-1234"></label>
<label class="field">Email<input class="search" id="cEmail" type="email" inputmode="email" autocomplete="off" autocapitalize="off" value="${esc(cur.email||'')}" placeholder="name@example.com"></label>
<div id="cMsg"></div><div class="btnrow"><button class="btn secondary" id="cancelModal">Cancel</button><button class="btn" id="saveContact">Save</button></div>`,()=>{
$('#saveContact').onclick=()=>{const phone=$('#cPhone').value.trim(),email=$('#cEmail').value.trim();const d=digitsOf(phone).replace('+','');
if(phone&&(d.length<7||d.length>15)){$('#cMsg').innerHTML='<div class="notice error">Enter a phone number with 7 to 15 digits.</div>';return;}
if(email&&!EMAIL_RX.test(email)){$('#cMsg').innerHTML='<div class="notice error">That email address doesn\'t look right.</div>';return;}
if(phone||email)state.manualContacts[id]={...(phone?{phone}:{}),...(email?{email}:{})};else delete state.manualContacts[id];
persist();closeModal();notice('Contact saved on this phone.');render();};});}

/* ---------- Secure (PIN) backup ---------- */
const PIN_RX=/^[\x20-\x7E]{6,64}$/;
function securePinModal(){if(!isNative()&&!WebCrypt.available())return notice('This browser cannot encrypt backups. Open the app from its https:// link.',true);
showModal(`<h2>Secure backup PIN</h2><p class="subtle">Choose a PIN or passphrase of at least 6 characters. Longer is much stronger — 8 or more digits, or a passphrase with letters, is recommended. Write it down somewhere safe: it cannot be recovered.</p>
<label class="field">PIN or passphrase<input class="search" id="pin1" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></label>
<label class="field">Enter it again<input class="search" id="pin2" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></label>
<label class="check"><input type="checkbox" id="showPin"> Show PIN</label><div id="pinMsg"></div>
<div class="btnrow"><button class="btn secondary" id="cancelModal">Cancel</button><button class="btn" id="doSecure">Encrypt &amp; save</button></div>`,()=>{
$('#showPin').onchange=e=>{for(const i of ['#pin1','#pin2'])$(i).type=e.target.checked?'text':'password';};
$('#pin1').focus();
$('#doSecure').onclick=()=>{const a=$('#pin1').value,b=$('#pin2').value;const msg=t=>{$('#pinMsg').innerHTML=`<div class="notice error">${esc(t)}</div>`;};
if(!PIN_RX.test(a))return msg('Use 6 to 64 characters (letters, numbers, or symbols).');
if(a!==b)return msg('The two entries don\'t match.');
if(/^(.)\1+$/.test(a)||'01234567890123456789'.includes(a)||'98765432109876543210'.includes(a))return msg('That PIN is too easy to guess. Avoid repeated or sequential digits.');
closeModal();notice('Encrypting backup on this phone…');
if(isNative())return window.Device.exportSecureBackup(JSON.stringify(state),a);
WebCrypt.encrypt(JSON.stringify(state),a).then(t=>offerFile('SquadronResources-SECURE-'+todayStamp()+'.json',t,true)).catch(e=>notice('Could not encrypt backup: '+e.message,true));};});}
/* Web backups: show a Save button so the share sheet opens from a fresh tap (required by iPhone). */
const todayStamp=()=>new Date().toISOString().slice(0,10);
function offerFile(name,text,secure){showModal(`<h2>${secure?'Secure backup ready':'Backup ready'}</h2><p class="subtle">${secure?'Encrypted with your PIN. ':''}On iPhone choose <strong>Save to Files</strong>; on Android it goes to Downloads.</p><div class="sample">${esc(name)}</div><div class="btnrow"><button class="btn secondary" id="cancelModal">Cancel</button><button class="btn" id="doSave">Save backup</button></div>`,()=>{
$('#doSave').onclick=async()=>{const file=new File([text],name,{type:'application/json'});
try{if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:name});closeModal();notice('Backup saved.');return;}}
catch(e){if(e.name==='AbortError'){return;}}
const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();setTimeout(()=>{URL.revokeObjectURL(url);link.remove();},5000);closeModal();notice('Backup downloaded: '+name);};});}
let webSealed=null;
/* Same format as the Android app: PBKDF2-HMAC-SHA256 (600,000) + AES-256-GCM, so backups move between devices. */
const WebCrypt={FORMAT:'squadron-resources-encrypted-v1',ITER:600000,
available(){return !!(window.crypto&&crypto.subtle&&window.isSecureContext!==false);},
isEncrypted(t){try{return JSON.parse(t).format===this.FORMAT;}catch(_){return false;}},
b64(u){let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);},
unb64(s){const b=atob(s);const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;},
async key(pin,salt,iter){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveKey']);
return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:iter},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);},
async encrypt(plain,pin){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
const k=await this.key(pin,salt,this.ITER);const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(this.FORMAT),tagLength:128},k,new TextEncoder().encode(plain)));
return JSON.stringify({format:this.FORMAT,note:'Encrypted Squadron Resources backup. Restore it in the app with the PIN used to create it.',kdf:'PBKDF2-HMAC-SHA256',iterations:this.ITER,cipher:'AES-256-GCM',salt:this.b64(salt),iv:this.b64(iv),data:this.b64(ct)},null,2);},
async decrypt(text,pin){const o=JSON.parse(text);if(o.format!==this.FORMAT)throw new Error('Not a secure Squadron Resources backup');
if(!(o.iterations>=100000&&o.iterations<=5000000))throw new Error('Unsupported backup settings');
const salt=this.unb64(o.salt),iv=this.unb64(o.iv),data=this.unb64(o.data);if(salt.length<16||iv.length!==12||data.length<17)throw new Error('Backup file is damaged');
const k=await this.key(pin,salt,o.iterations);
try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(this.FORMAT),tagLength:128},k,data));}
catch(_){throw new Error('Incorrect PIN, or the backup file is damaged.');}}};
window.onEncryptedBackup=()=>{showModal(`<h2>Unlock secure backup</h2><p class="subtle">Enter the PIN or passphrase used when this backup was created.</p>
<label class="field">PIN or passphrase<input class="search" id="pinOpen" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"></label><div id="pinMsg"></div>
<div class="btnrow"><button class="btn secondary" id="cancelModal">Cancel</button><button class="btn" id="doUnlock">Unlock</button></div>`,()=>{
const go=()=>{const p=$('#pinOpen').value;if(!p)return;$('#doUnlock').disabled=true;$('#pinMsg').innerHTML='<div class="notice">Checking PIN…</div>';if(isNative())return window.Device.decryptBackup(p);
const sealed=webSealed;WebCrypt.decrypt(sealed,p).then(t=>{webSealed=null;window.onBackupImported(t);}).catch(e=>window.onSecureBackupError(e.message));};
$('#doUnlock').onclick=go;$('#pinOpen').addEventListener('keydown',e=>{if(e.key==='Enter')go();});$('#pinOpen').focus();},'decrypt');};
window.onSecureBackupError=msg=>{if(modalKind==='decrypt'&&$('#pinMsg')){$('#pinMsg').innerHTML=`<div class="notice error">${esc(msg)}</div>`;$('#doUnlock').disabled=false;$('#pinOpen').select();}else notice(msg,true);};

window.onReportImported=raw=>{try{const data=JSON.parse(raw);if(!pending)throw new Error('Unexpected report');if(pending.type!==data.type)pending.note=`That file is the ${names[data.type]}, so it was read as that report.`;pending.type=data.type;const type=data.type;
if(!Array.isArray(data.records)||!Array.isArray(data.members))throw new Error('Invalid report data');
const prev=records(type).length, warnings=data.warnings||[];pending.data=data;
const extra=data.contacts&&Array.isArray(data.contacts.records)&&data.contacts.records.length?data.contacts:null;
showModal(`<h2>Review ${esc(names[type])}</h2><p class="subtle">Only apply if the record count looks correct.</p>${pending.note?`<div class="notice">${esc(pending.note)}</div>`:''}${data.totals?`<div class="notice ${data.totals.records===data.records.length&&data.totals.members===data.members.length?'ok':'error'}">Report header: ${data.totals.members} members, ${data.totals.records} assignments. Read: ${data.members.length} members, ${data.records.length} assignments.</div>`:''}
<div class="stats"><div class="stat"><label>Records found</label><strong>${data.records.length}</strong></div><div class="stat"><label>Members found</label><strong>${data.members.length}</strong></div></div>
${prev?`<div class="notice">Previous report: ${prev} records. Change: ${data.records.length-prev>=0?'+':''}${data.records.length-prev}.</div>`:''}
${data.unit&&shortUnit(data.unit)!==state.settings.unit?`<div class="notice error">This report is for ${esc(data.unit)}, but the app is set to ${esc(state.settings.unit)}.${unitName(shortUnit(data.unit))?`<label class="check"><input type="checkbox" id="adoptUnit"> Switch the app to ${esc(unitName(shortUnit(data.unit)))}</label>`:''}</div>`:''}
${data.layout?`<div class="notice ok">Recognized: ${esc(data.layout)} report${data.unit?' for '+esc(data.unit):''}.</div>`:''}
${extra?`<div class="notice ok">This ZIP also contains the Contact Report: phone/email for ${extra.records.length} members. It will be updated too.</div>`:''}
${warnings.length?`<div class="notice error">${warnings.length} extraction warning(s). Verify before continuing.<div class="sample">${esc(warnings.slice(0,8).join('\n'))}</div></div>`:'<div class="notice ok">No parser warnings reported.</div>'}
<div class="sample">Example records:\n${esc(JSON.stringify(data.records.slice(0,2),null,2))}</div>
<div class="btnrow"><button class="btn secondary" id="cancelModal">Cancel</button><button class="btn" id="confirmImport">Apply report</button></div>`,()=>{$('#confirmImport').onclick=()=>{if(!pending?.data)return;
const now=new Date().toISOString();const copy={...data};delete copy.contacts;state.datasets[type]=copy;state.updated[type]=now;
if(extra){state.datasets.contacts=extra;state.updated.contacts=now;}
if($('#adoptUnit')?.checked){const c=shortUnit(data.unit);state.settings={unit:c,name:unitName(c),number:c===DEFAULT_SETTINGS.unit?DEFAULT_SETTINGS.number:''};}
persist();closeModal();notice(`${names[type]} updated: ${data.records.length} records.${extra?' Contacts updated too.':''}`);render();};});
}catch(e){notice('Report could not be reviewed: '+e.message,true);}}
window.onBackupImported=raw=>{try{const imported=JSON.parse(raw);if(imported.format!==state.format||!imported.datasets||typeof imported.datasets!=='object')throw new Error('Not a supported Squadron Resources backup');
for(const type of TYPES){if(imported.datasets[type] && (!Array.isArray(imported.datasets[type].records)||!Array.isArray(imported.datasets[type].members)))throw new Error('Backup contains invalid '+type+' records');}
imported.manualContacts=(imported.manualContacts&&typeof imported.manualContacts==='object')?imported.manualContacts:{};imported.updated=imported.updated||{};imported.settings={...DEFAULT_SETTINGS,...(imported.settings||{})};
modalKind='';showModal(`<h2>Restore backup?</h2><p class="subtle">This will replace all local report categories and saved contacts with the contents of the backup.</p><p>${TYPES.map(t=>esc(names[t])+': '+(imported.datasets[t]?.records.length||0)).join('<br>')}<br>Saved contacts: ${Object.keys(imported.manualContacts).length}</p><div class="btnrow"><button class="btn secondary" id="cancelModal">Cancel</button><button class="btn" id="confirmRestore">Restore</button></div>`,()=>{$('#confirmRestore').onclick=()=>{state=imported;persist();closeModal();notice('Backup restored successfully.');render();};});
}catch(e){notice('Backup rejected: '+e.message,true);}}
window.onNativeError=message=>{pending=null;notice(message,true);};
window.onNativeNotice=message=>notice(message);
window.handleBack=()=>{if(!$('#modalBackdrop').classList.contains('hidden')){closeModal();return true;}if(memberID){memberID=null;render();return true;}if(view!=='home'){switchView('home');return true;}return false;};
document.querySelectorAll('.tabs button').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));
$('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
render();
const foot=document.querySelector('footer');if(foot)foot.textContent='Stored only on this device · Version '+APP_VERSION+(isNative()?' (Android app)':'')+' · Imported reports are not live eServices records.';
if(!isNative()){try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist();}catch(_){}
if('serviceWorker' in navigator&&window.isSecureContext&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});}
})();
