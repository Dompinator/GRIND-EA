/* GRIND-EA multi-company + GPU / CHIP workspace */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let companies=[],activeGpuView='design',chips=[],gpuFans=[{position:.28,type:'basic'},{position:.72,type:'basic'}],dragFan=-1,gpuBody='plastic',gpuRgb=false;
const GPU_RESEARCH=[
 {key:'gpu_metallic_body',name:'Metallic Body',cost:3500,value:1200,score:18,group:'GPU'},
 {key:'gpu_carbon_body',name:'Carbon Body',cost:7800,value:4000,score:29,group:'GPU',pre:'gpu_metallic_body'},
 {key:'gpu_rgb',name:'RGB',cost:4800,value:480,score:12,group:'GPU'},
 {key:'gpu_small_fans',name:'Small Fans',cost:125,value:80,score:8,group:'GPU'},
 {key:'gpu_medium_fans',name:'Medium Fans',cost:800,value:200,score:14,group:'GPU',pre:'gpu_small_fans'},
 {key:'gpu_smart_fans',name:'Smart Fans',cost:2800,value:1400,score:22,group:'GPU',pre:'gpu_medium_fans'},
 {key:'chip_ok_speed',name:'OK Speed',cost:75,value:30,score:4,group:'CHIP'},
 {key:'chip_decent_speed',name:'Decent Speed',cost:150,value:70,score:8,group:'CHIP',pre:'chip_ok_speed'},
 {key:'chip_good_speed',name:'Good Speed',cost:300,value:180,score:13,group:'CHIP',pre:'chip_decent_speed'},
 {key:'chip_fast_speed',name:'Fast Speed',cost:650,value:360,score:18,group:'CHIP',pre:'chip_good_speed'},
 {key:'chip_insane_speed',name:'Insane Speed',cost:1500,value:800,score:26,group:'CHIP',pre:'chip_fast_speed'},
 {key:'chip_super_speed',name:'Super Speed',cost:4500,value:1800,score:36,group:'CHIP',pre:'chip_insane_speed'},
 {key:'chip_decent_power',name:'Decent Power',cost:250,value:80,score:6,group:'CHIP'},
 {key:'chip_good_power',name:'Good Power',cost:800,value:120,score:14,group:'CHIP',pre:'chip_decent_power'},
 {key:'chip_strong_power',name:'Strong Power',cost:2600,value:900,score:26,group:'CHIP',pre:'chip_good_power'},
 {key:'chip_super_powerful',name:'Super Powerful',cost:6800,value:2800,score:48,group:'CHIP',pre:'chip_strong_power'}
];
const isGpu=()=>!!(currentCompany?.product_lines||[]).includes('gpu');
const researched=k=>(companyResearchRows||[]).some(x=>x.research_key===k);
function companyShell(){
 let root=$('#eaCompanyShell');if(root)return root;
 const page=$('#page-company');if(!page)return null;
 root=document.createElement('div');root.id='eaCompanyShell';root.className='ea-company-shell';
 page.prepend(root);return root;
}
function renderChooser(){
 const root=companyShell();if(!root)return;
 if(currentCompany){root.innerHTML='';root.classList.add('hidden');$('#companyOnboarding')?.classList.add('hidden');$('#companyDashboard')?.classList.remove('hidden');return;}
 root.classList.remove('hidden');$('#companyOnboarding')?.classList.add('hidden');$('#companyDashboard')?.classList.add('hidden');
 root.innerHTML='<div class="ea-company-heading"><div class="eyebrow purple-text">COMPANY WORKSPACE</div><h3>Select a company</h3><p class="muted">Open a company dashboard, or create another company. Maximum 3 companies.</p></div><div class="ea-company-grid">'+companies.map(c=>'<button class="ea-company-card" data-company-open="'+esc(c.id)+'"><span class="ea-company-logo">'+(c.logo_data_url?'<img src="'+esc(c.logo_data_url)+'" alt="">':'▣')+'</span><span><b>'+esc(c.company_name)+'</b><small>'+((c.product_lines||[]).includes('gpu')?'GPU Manufacturing':'CPU Manufacturing')+'</small></span><strong>Open →</strong></button>').join('')+'</div><button class="primary-btn" id="eaCreateCompany" '+(companies.length>=3?'disabled':'')+'>'+(companies.length>=3?'Company limit reached (3/3)':'＋ Create company')+'</button><div id="eaCompanyCreateWrap" class="ea-company-create hidden"><h4>Create a company</h4><form id="eaCompanyCreateForm"><label>Company name<input id="eaCompanyName" maxlength="40" minlength="2" required placeholder="e.g. Nova Graphics"></label><label>Description<textarea id="eaCompanyDescription" maxlength="500" rows="2" placeholder="What does your company make?"></textarea></label><label>Product line<select id="eaCompanyLine"><option value="cpu">CPU Manufacturing</option><option value="gpu">GPU Manufacturing</option></select></label><button class="primary-btn" type="submit">Create company</button><p id="eaCompanyCreateMessage" class="form-message"></p></form></div>';
 root.querySelectorAll('[data-company-open]').forEach(b=>b.addEventListener('click',()=>selectCompany(b.dataset.companyOpen)));
 $('#eaCreateCompany')?.addEventListener('click',()=>$('#eaCompanyCreateWrap')?.classList.toggle('hidden'));
 $('#eaCompanyCreateForm')?.addEventListener('submit',createCompany);
}
async function refreshCompanies(){
 if(!currentUser||!sb)return;
 const {data,error}=await sb.from('product_companies').select('id,owner_id,company_name,logo_data_url,description,product_lines,total_revenue,total_costs,change_pct,created_at').eq('owner_id',currentUser.id).order('created_at',{ascending:true}).limit(3);
 if(error){console.error('Company list:',error);return;}
 companies=data||[];
 if(currentCompany&&!companies.some(c=>c.id===currentCompany.id))currentCompany=null;
 renderChooser();
}
async function selectCompany(id){
 const c=companies.find(x=>x.id===id);if(!c)return;
 currentCompany=c;localStorage.setItem('grind_active_company_id',id);
 companyResearchRows=[];companyProducts=[];selectedCompanyProductId=null;
 await loadCompanyResearchAndProducts();
 if(typeof renderCompanyDashboard==='function')renderCompanyDashboard();
 renderChooser();
 if(isGpu())mountGpuWorkspace();
}
async function createCompany(e){
 e.preventDefault();const msg=$('#eaCompanyCreateMessage');
 if(companies.length>=3){msg.textContent='You can own a maximum of 3 companies.';return;}
 const name=$('#eaCompanyName').value.trim(),line=$('#eaCompanyLine').value,desc=$('#eaCompanyDescription').value.trim();
 if(name.length<2){msg.textContent='Company name must be at least 2 characters.';return;}
 const {data,error}=await sb.from('product_companies').insert({owner_id:currentUser.id,company_name:name,description:desc,product_lines:[line]}).select('id,owner_id,company_name,logo_data_url,description,product_lines,total_revenue,total_costs,change_pct,created_at').single();
 if(error){msg.textContent=error.message;return;}
 companies.push(data);renderChooser();toast('Company created. Select it to open the dashboard.');
}
function addBackButton(){
 const dash=$('#companyDashboard');if(!dash||$('#eaBackCompanies'))return;
 const b=document.createElement('button');b.id='eaBackCompanies';b.className='zoom-btn';b.type='button';b.textContent='← All companies';
 b.addEventListener('click',()=>{currentCompany=null;localStorage.removeItem('grind_active_company_id');renderChooser();});
 dash.prepend(b);
}
function mountGpuWorkspace(){
 if(!isGpu())return;
 const dash=$('#companyDashboard');if(!dash)return;
 let panel=$('#eaGpuPanel');
 if(!panel){
  panel=document.createElement('section');panel.id='eaGpuPanel';panel.className='company-dashboard-section ea-gpu-panel';
  panel.innerHTML='<div class="ea-gpu-tabs"><button data-gpu-tab="design" class="active">GPU Design</button><button data-gpu-tab="chips">Chips</button><button data-gpu-tab="gpuResearch">GPU Research</button><button data-gpu-tab="chipResearch">CHIP Research</button></div><div id="eaGpuDesign" class="ea-gpu-view"><div class="ea-gpu-layout"><div class="ea-gpu-preview"><div class="ea-gpu-label">LIVE GRAPHICS CARD PREVIEW <small>Drag fans to reposition</small></div><canvas id="eaGpuCanvas" width="900" height="480"></canvas><div id="eaGpuCost" class="ea-gpu-cost"></div></div><div class="ea-gpu-controls"><label>GPU name<input id="eaGpuName" maxlength="48" value="New Graphics Card"></label><label>Saved chip<select id="eaGpuChipSelect"><option value="">Loading chips...</option></select></label><label>Length <input id="eaGpuLength" type="range" min="180" max="420" value="300"></label><label>Width <input id="eaGpuWidth" type="range" min="90" max="180" value="125"></label><label>Fan type<select id="eaGpuFanType"><option value="gpu_small_fans">Small Fans</option><option value="gpu_medium_fans">Medium Fans</option><option value="gpu_smart_fans">Smart Fans</option></select></label><div class="ea-fan-row"><span>Fans: <b id="eaGpuFanCount">2</b></span><button id="eaGpuRemoveFan" type="button">−</button><button id="eaGpuAddFan" type="button">＋ Add fan</button></div><label>Body type<select id="eaGpuBody"><option value="plastic">Plastic · Free</option><option value="metallic">Metallic</option><option value="carbon">Carbon</option></select></label><label class="ea-check"><input type="checkbox" id="eaGpuRgb"> RGB lighting</label><label>Listing price<input id="eaGpuPrice" type="number" min="1" value="1200"></label><button class="primary-btn" id="eaGpuSave" type="button">Save as draft</button><p id="eaGpuMessage" class="form-message"></p></div></div></div><div id="eaGpuChips" class="ea-gpu-view hidden"><div class="ea-chip-layout"><div><h4>GPU Chip Designer</h4><p class="muted">Simple silver package. Only the chip name changes visually.</p><div class="ea-chip-preview"><span id="eaChipPreviewName">NOVA</span></div></div><div class="ea-gpu-controls"><label>Chip name<input id="eaChipName" maxlength="40" value="Nova GPU Chip"></label><label>Speed<select id="eaChipSpeed"></select></label><label>Power<select id="eaChipPower"></select></label><div class="ea-vram"><b>VRAM</b><small>Reserved section. Research upgrades will be added later.</small></div><button class="primary-btn" id="eaSaveChip" type="button">Save chip</button><p id="eaChipMessage" class="form-message"></p></div></div><div id="eaSavedChips" class="ea-saved-chips"></div></div><div id="eaGpuResearch" class="ea-gpu-view hidden"><h4>GPU Research</h4><div id="eaGpuResearchList" class="ea-research-list"></div></div><div id="eaChipResearch" class="ea-gpu-view hidden"><h4>CHIP Research</h4><div id="eaChipResearchList" class="ea-research-list"></div></div>';
  dash.appendChild(panel);
  panel.querySelectorAll('[data-gpu-tab]').forEach(b=>b.addEventListener('click',()=>setGpuTab(b.dataset.gpuTab)));
  document.querySelectorAll('[data-company-tab]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.companyTab!=='gpu')$('#eaGpuPanel')?.classList.add('hidden');}));
  ['eaGpuLength','eaGpuWidth','eaGpuBody','eaGpuRgb','eaGpuPrice'].forEach(id=>$('#'+id)?.addEventListener('input',drawGpu));
  $('#eaGpuAddFan')?.addEventListener('click',()=>{const type=$('#eaGpuFanType').value;if(!researched(type)){toast('Research this fan type first.');return;}if(gpuFans.length<6)gpuFans.push({position:.5,type});drawGpu();});
  $('#eaGpuRemoveFan')?.addEventListener('click',()=>{if(gpuFans.length>1)gpuFans.pop();drawGpu();});
  $('#eaGpuFanType')?.addEventListener('change',()=>{});
  $('#eaChipName')?.addEventListener('input',()=>$('#eaChipPreviewName').textContent=$('#eaChipName').value.slice(0,14).toUpperCase());
  $('#eaSaveChip')?.addEventListener('click',saveChip);$('#eaGpuSave')?.addEventListener('click',saveGpu);
  const canvas=$('#eaGpuCanvas');
  canvas?.addEventListener('pointerdown',e=>{const p=canvasPoint(e);dragFan=nearestFan(p.x,p.y);canvas.setPointerCapture(e.pointerId);});
  canvas?.addEventListener('pointermove',e=>{if(dragFan<0)return;const p=canvasPoint(e);gpuFans[dragFan].position=Math.max(.08,Math.min(.92,(p.x-140)/620));drawGpu();});
  canvas?.addEventListener('pointerup',()=>dragFan=-1);canvas?.addEventListener('pointercancel',()=>dragFan=-1);
 }
 addBackButton();renderResearchLists();loadChips();drawGpu();
 const tabs=$('.company-dashboard-tabs');if(tabs&&!$('#eaGpuTab')){const b=document.createElement('button');b.id='eaGpuTab';b.className='company-dashboard-tab';b.textContent='GPU / CHIP';b.addEventListener('click',()=>{document.querySelectorAll('[data-company-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.company-dashboard-panel').forEach(x=>x.classList.add('hidden'));$('#eaGpuPanel').classList.remove('hidden');});tabs.appendChild(b);}
}
function setGpuTab(tab){
 document.querySelectorAll('[data-gpu-tab]').forEach(b=>b.classList.toggle('active',b.dataset.gpuTab===tab));
 ['design','chips','gpuResearch','chipResearch'].forEach(k=>$('#eaGpu'+k[0].toUpperCase()+k.slice(1))?.classList.toggle('hidden',k!==tab));
 if(tab==='chips')loadChips();if(tab==='gpuResearch'||tab==='chipResearch')renderResearchLists();
}
function renderResearchLists(){
 const render=(target,group)=>{const el=$(target);if(!el)return;el.innerHTML=GPU_RESEARCH.filter(r=>r.group===group).map(r=>{const yes=researched(r.key),locked=r.pre&&!researched(r.pre);return '<article class="ea-research-card"><div><b>'+r.name+'</b><small>Research $'+r.cost.toLocaleString()+' · Value $'+r.value.toLocaleString()+' · '+r.score+' Score'+(locked?' · Requires '+GPU_RESEARCH.find(x=>x.key===r.pre).name:'')+'</small></div><button data-research-key="'+r.key+'" '+(yes||locked?'disabled':'')+'>'+(yes?'Unlocked':locked?'Locked':'Research')+'</button></article>';}).join('');el.querySelectorAll('[data-research-key]').forEach(b=>b.addEventListener('click',()=>unlockResearch(b.dataset.researchKey,group)));};
 render('#eaGpuResearchList','GPU');render('#eaChipResearchList','CHIP');
}
async function unlockResearch(key,group){
 const {data,error}=await sb.rpc('unlock_company_research',{p_company_id:currentCompany.id,p_research_key:key});
 if(error){toast(error.message);return;}if(data?.cash_remaining!==undefined)currentUser.cash=data.cash_remaining;
 await loadCompanyResearchAndProducts();renderResearchLists();updateUIProfile?.();toast('Research unlocked!');
}
function optionsFor(kind,keys){
 const el=$(kind);if(!el)return;const defs=GPU_RESEARCH.filter(x=>keys.includes(x.key));
 el.innerHTML='<option value="none">Base '+(kind==='#eaChipSpeed'?'speed':'power')+'</option>'+defs.map(r=>'<option value="'+r.key+'" '+(!researched(r.key)?'disabled':'')+'>'+r.name+(researched(r.key)?'':' · Research locked')+'</option>').join('');
}
async function saveChip(){
 const name=$('#eaChipName').value.trim(),speed=$('#eaChipSpeed').value,power=$('#eaChipPower').value;
 if(name.length<2){$('#eaChipMessage').textContent='Chip name must be at least 2 characters.';return;}
 const {error}=await sb.from('product_company_gpu_chips').insert({company_id:currentCompany.id,owner_id:currentUser.id,chip_name:name,speed_level:speed,power_level:power,vram_level:'none'});
 $('#eaChipMessage').textContent=error?'Could not save chip: '+error.message:'Chip saved successfully.';
 if(!error){toast('Chip saved to Chips.');loadChips();}
}
async function loadChips(){
 if(!currentCompany)return;const {data,error}=await sb.from('product_company_gpu_chips').select('*').eq('company_id',currentCompany.id).order('created_at',{ascending:false});
 const wrap=$('#eaSavedChips');if(error){if(wrap)wrap.textContent=error.message;return;}chips=data||[];
 const select=$('#eaGpuChipSelect');if(select)select.innerHTML='<option value="">Choose a saved chip</option>'+chips.map(c=>'<option value="'+c.id+'">'+esc(c.chip_name)+'</option>').join('');
 if(wrap)wrap.innerHTML=chips.map(c=>'<button class="ea-chip-card" data-chip-select="'+c.id+'"><span>▦</span><b>'+esc(c.chip_name)+'</b><small>'+esc(c.speed_level)+' · '+esc(c.power_level)+'</small></button>').join('')||'<p class="muted">No chips saved yet.</p>';
 wrap?.querySelectorAll('[data-chip-select]').forEach(b=>b.addEventListener('click',()=>{setGpuTab('design');$('#eaGpuChipSelect').value=b.dataset.chipSelect;}));
 optionsFor('#eaChipSpeed',['chip_ok_speed','chip_decent_speed','chip_good_speed','chip_fast_speed','chip_insane_speed','chip_super_speed']);
 optionsFor('#eaChipPower',['chip_decent_power','chip_good_power','chip_strong_power','chip_super_powerful']);
}
function canvasPoint(e){const r=$('#eaGpuCanvas').getBoundingClientRect();return {x:(e.clientX-r.left)*900/r.width,y:(e.clientY-r.top)*480/r.height};}
function fanCoords(){const c=$('#eaGpuCanvas');const len=Number($('#eaGpuLength')?.value||300),w=Number($('#eaGpuWidth')?.value||125),scale=Math.min(1.6,Math.min(650/len,300/w)),gw=len*scale,gh=w*scale,x=(900-gw)/2,y=(480-gh)/2;return gpuFans.map(f=>({x:x+gw*f.position,y:y+gh/2,r:Math.min(gh*.34,gw/gpuFans.length*.34),type:f.type}));}
function nearestFan(x,y){const arr=fanCoords();let best=-1,dist=1e9;arr.forEach((p,i)=>{const d=Math.hypot(p.x-x,p.y-y);if(d<p.r*1.7&&d<dist){best=i;dist=d;}});return best;}
function drawGpu(){
 const c=$('#eaGpuCanvas');if(!c)return;
 const ctx=c.getContext('2d');ctx.clearRect(0,0,900,480);ctx.fillStyle='#0b0b13';ctx.fillRect(0,0,900,480);
 const len=Number($('#eaGpuLength')?.value||300),wid=Number($('#eaGpuWidth')?.value||125),body=$('#eaGpuBody')?.value||'plastic',rgb=$('#eaGpuRgb')?.checked||false;
 const scale=Math.min(1.6,Math.min(650/len,300/wid)),w=len*scale,h=wid*scale,x=(900-w)/2,y=(480-h)/2;
 ctx.fillStyle=body==='carbon'?'#20242b':body==='metallic'?'#8993a2':'#36323f';ctx.strokeStyle=rgb?'#bd70ff':'#8d75aa';ctx.lineWidth=5;ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(24,h*.15));ctx.fill();ctx.stroke();
 fanCoords().forEach(f=>{ctx.fillStyle='#15151e';ctx.beginPath();ctx.arc(f.x,f.y,f.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle=rgb?'#bd70ff':'#737b8a';ctx.lineWidth=5;ctx.stroke();for(let j=0;j<7;j++){const angle=j*Math.PI*2/7;ctx.beginPath();ctx.moveTo(f.x,f.y);ctx.lineTo(f.x+Math.cos(angle)*f.r*.8,f.y+Math.sin(angle)*f.r*.8);ctx.strokeStyle='#b7bfca';ctx.lineWidth=8;ctx.stroke();}ctx.fillStyle='#929aa7';ctx.beginPath();ctx.arc(f.x,f.y,f.r*.17,0,Math.PI*2);ctx.fill();});
 ctx.fillStyle='#eee8f8';ctx.font='bold 20px Arial';ctx.fillText('GRIND',x+12,y+24);
 $('#eaGpuFanCount').textContent=String(gpuFans.length);
 const bodyValue=body==='carbon'?4000:body==='metallic'?1200:0;
 const fanValue=gpuFans.reduce((sum,f)=>sum+(f.type==='gpu_smart_fans'?1400:f.type==='gpu_medium_fans'?200:f.type==='gpu_small_fans'?80:0),0);
 const rgbValue=rgb?480:0,total=bodyValue+fanValue+rgbValue;
 $('#eaGpuCost').textContent='Estimated product value: $'+total.toLocaleString()+' · Body $'+bodyValue.toLocaleString()+' · Fans $'+fanValue.toLocaleString()+' · RGB $'+rgbValue.toLocaleString();
}
async function saveGpu(){
 const name=$('#eaGpuName').value.trim(),chipId=$('#eaGpuChipSelect').value,body=$('#eaGpuBody').value,rgb=$('#eaGpuRgb').checked;
 if(name.length<2||!chipId){$('#eaGpuMessage').textContent='Enter a name and choose a saved chip.';return;}
 if(body==='metallic'&&!researched('gpu_metallic_body')||body==='carbon'&&!researched('gpu_carbon_body')||rgb&&!researched('gpu_rgb')){toast('Research the selected GPU component first.');return;}
 const chip=chips.find(x=>x.id===chipId);if(!chip){await loadChips();$('#eaGpuMessage').textContent='Selected chip not found. Choose it again.';return;}
 const len=Number($('#eaGpuLength').value),wid=Number($('#eaGpuWidth').value),fanValue=gpuFans.reduce((sum,f)=>sum+(f.type==='gpu_smart_fans'?1400:f.type==='gpu_medium_fans'?200:f.type==='gpu_small_fans'?80:0),0),bodyValue=body==='carbon'?4000:body==='metallic'?1200:0,rgbValue=rgb?480:0,total=fanValue+bodyValue+rgbValue;
 const {error}=await sb.from('product_company_products').insert({company_id:currentCompany.id,owner_id:currentUser.id,product_line:'gpu',product_name:name,body_type:body,production_cost:total,product_value:total,listed_price:Math.max(1,Number($('#eaGpuPrice').value)||1),status:'draft',design_data:{chip_id:chip.id,chip_name:chip.chip_name,length:len,width:wid,fan_positions:gpuFans,fan_count:gpuFans.length,body,rgb}});
 $('#eaGpuMessage').textContent=error?'Could not save GPU draft: '+error.message:'GPU saved as a draft. You can publish it later from Products.';
 if(!error){toast('GPU draft saved.');await loadCompanyResearchAndProducts();}
}
const originalLoad=window.loadCompanyDashboard;
window.loadCompanyDashboard=async function(){
 if(!currentUser||!sb)return;
 await refreshCompanies();
 const {data:invites}=await sb.from('product_company_transfers').select('id,company_id,sender_id,created_at,product_companies(company_name,logo_data_url)').eq('recipient_id',currentUser.id).eq('status','pending').order('created_at',{ascending:false}).limit(10);
 incomingCompanyTransfers=invites||[];renderCompanyIncomingTransfers?.();
 renderChooser();
 if(currentCompany){await loadCompanyResearchAndProducts();if(typeof renderCompanyDashboard==='function')renderCompanyDashboard();if(isGpu())mountGpuWorkspace();}
};
const oldRender=window.renderCompanyDashboard;
window.renderCompanyDashboard=function(){oldRender?.();renderChooser();if(currentCompany){addBackButton();if(isGpu()){mountGpuWorkspace();document.querySelector('[data-company-tab=\"research\"]')?.classList.add('hidden');$('#companyPanelResearch')?.classList.add('hidden');}else{$('#eaGpuPanel')?.classList.add('hidden');document.querySelector('[data-company-tab=\"research\"]')?.classList.remove('hidden');}}};
const oldShow=window.showPage;
window.showPage=function(page){
 if((page==='company-design'||page==='company-products')&&!currentCompany){oldShow?.('company');return;}
 if(page==='company-design'&&isGpu()){oldShow?.('company');mountGpuWorkspace();setGpuTab('design');return;}
 if(page==='company-products'&&isGpu()){oldShow?.('company');mountGpuWorkspace();setGpuTab('chips');return;}
 oldShow?.(page);
 if(page==='company')renderChooser();
};
document.addEventListener('DOMContentLoaded',()=>{refreshCompanies();});
if(sb?.auth?.onAuthStateChange)sb.auth.onAuthStateChange(()=>{setTimeout(()=>refreshCompanies(),0);});
})()