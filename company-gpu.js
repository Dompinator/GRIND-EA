/* GRIND-EA multi-company + GPU / CHIP workspace */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let companies=[],activeGpuView='design',chips=[],gpuFans=[{position:.28,type:'basic'},{position:.72,type:'basic'}],dragFan=-1,gpuBody='plastic',gpuRgb=false,gpuBrandLogo='';
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
 if(!currentCompany){const savedId=localStorage.getItem('grind_active_company_id');currentCompany=companies.find(c=>c.id===savedId)||null;}
 renderChooser();
}
async function selectCompany(id){
 const c=companies.find(x=>x.id===id);if(!c)return;
 currentCompany=c;localStorage.setItem('grind_active_company_id',id);
 companyResearchRows=[];companyProducts=[];selectedCompanyProductId=null;
 await loadCompanyResearchAndProducts();
 if(typeof renderCompanyDashboard==='function')renderCompanyDashboard();
 renderChooser();
 if(isGpu()){mountGpuWorkspace();mountGpuResearch();renderGpuProducts();}else{hideGpuWorkspace();}
 syncCompanyDesignMode();

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
 if(!isGpu())return;$('#page-company-design #cpuDesigner')?.classList.add('hidden');$('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');
 const dash=$('#page-company-design');if(!dash)return;
 let panel=$('#eaGpuPanel');
 if(!panel){
  panel=document.createElement('section');panel.id='eaGpuPanel';panel.className='company-dashboard-section ea-gpu-panel';
  panel.innerHTML='<div class="ea-gpu-tabs"><button data-gpu-tab="design" class="active">GPU</button><button data-gpu-tab="chips">CHIP</button></div><div id="eaGpuDesign" class="ea-gpu-view"><div class="ea-gpu-layout"><div class="ea-gpu-preview"><div class="ea-gpu-label">LIVE GRAPHICS CARD PREVIEW <small>Drag fans to reposition</small></div><div id="eaGpu3DStage" class="ea-gpu-3d-stage"><div class="gpu-3d-loading">Loading realistic 3D GPU editor…</div></div><div id="eaGpuCost" class="ea-gpu-cost"></div></div><div class="ea-gpu-controls"><label>GPU name<input id="eaGpuName" maxlength="48" value="New Graphics Card"></label><label>Saved chip<select id="eaGpuChipSelect"><option value="">Loading chips...</option></select></label><label>Length <input id="eaGpuLength" type="range" min="180" max="420" value="300"></label><label>Width <input id="eaGpuWidth" type="range" min="90" max="180" value="125"></label><label>Fan type<select id="eaGpuFanType"><option value="gpu_small_fans">Small Fans</option><option value="gpu_medium_fans">Medium Fans</option><option value="gpu_smart_fans">Smart Fans</option></select></label><div class="ea-fan-row"><span>Fans: <b id="eaGpuFanCount">2</b></span><button id="eaGpuRemoveFan" type="button">−</button><button id="eaGpuAddFan" type="button">＋ Add fan</button></div><label>Body type<select id="eaGpuBody"><option value="plastic">Plastic · Free</option><option value="metallic">Metallic</option><option value="carbon">Carbon</option></select></label><label>Shroud shape<select id="eaGpuShroud"><option value="rounded">Rounded</option><option value="angular">Angular</option><option value="compact">Compact</option></select></label><label class="ea-check"><input type="checkbox" id="eaGpuBackplate" checked> Backplate</label><label>Branding text<input id="eaGpuBrand" maxlength="20" value="GRIND"></label><label>Brand logo<input type="file" id="eaGpuLogo" accept="image/png,image/jpeg,image/webp"></label><label class="ea-check"><input type="checkbox" id="eaGpuRgb"> RGB lighting</label><label>Listing price<input id="eaGpuPrice" type="number" min="1" value="1200"></label><button class="primary-btn" id="eaGpuSave" type="button">Save as draft</button><p id="eaGpuMessage" class="form-message"></p></div></div></div><div id="eaGpuChips" class="ea-gpu-view hidden"><div class="ea-chip-layout"><div><h4>GPU Chip Designer</h4><p class="muted">Simple silver package. Only the chip name changes visually.</p><div class="ea-chip-preview"><span id="eaChipPreviewName">NOVA</span></div></div><div class="ea-gpu-controls"><label>Chip name<input id="eaChipName" maxlength="40" value="Nova GPU Chip"></label><label>Speed<select id="eaChipSpeed"></select></label><label>Power<select id="eaChipPower"></select></label><div class="ea-vram"><b>VRAM</b><small>Reserved section. Research upgrades will be added later.</small></div><button class="primary-btn" id="eaSaveChip" type="button">Save chip</button><p id="eaChipMessage" class="form-message"></p></div></div><div id="eaSavedChips" class="ea-saved-chips"></div></div>';
  dash.appendChild(panel);
  panel.querySelectorAll('[data-gpu-tab]').forEach(b=>b.addEventListener('click',()=>setGpuTab(b.dataset.gpuTab)));
  document.querySelectorAll('[data-company-tab]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.companyTab!=='gpu')$('#eaGpuPanel')?.classList.add('hidden');}));
  ['eaGpuLength','eaGpuWidth','eaGpuBody','eaGpuShroud','eaGpuBackplate','eaGpuBrand','eaGpuRgb','eaGpuPrice'].forEach(id=>$('#'+id)?.addEventListener('input',drawGpu));
  $('#eaGpuLogo')?.addEventListener('change',readGpuLogo);
  $('#eaGpuAddFan')?.addEventListener('click',()=>{const type=$('#eaGpuFanType').value;if(!researched(type)){toast('Research this fan type first.');return;}if(gpuFans.length<6)gpuFans.push({position:.5,type});drawGpu();});
  $('#eaGpuRemoveFan')?.addEventListener('click',()=>{if(gpuFans.length>1)gpuFans.pop();drawGpu();});
  $('#eaGpuFanType')?.addEventListener('change',()=>{});
  $('#eaChipName')?.addEventListener('input',()=>$('#eaChipPreviewName').textContent=$('#eaChipName').value.slice(0,14).toUpperCase());
  $('#eaSaveChip')?.addEventListener('click',saveChip);$('#eaGpuSave')?.addEventListener('click',saveGpu);
  window.GpuDesigner3D?.mount($('#eaGpu3DStage'));

 }
 addBackButton();renderResearchLists();loadChips();window.GpuDesigner3D?.mount($('#eaGpu3DStage'));drawGpu();
 
}
function mountGpuResearch(){
 const section=$('#companyPanelResearch .research-section');if(!section)return;
 $('#cpuResearchTree')?.classList.toggle('hidden',isGpu());
 let wrap=$('#eaCompanyResearch');
 if(!wrap){
  wrap=document.createElement('div');wrap.id='eaCompanyResearch';wrap.className='ea-company-research';
  wrap.innerHTML='<div class="ea-research-subtabs"><button type="button" data-ea-research="GPU" class="active">GPU</button><button type="button" data-ea-research="CHIP">CHIP</button></div><div id="eaGpuResearchTree" class="research-tree"><div id="eaGpuResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-ea-zoom="out">−</button><button type="button" data-ea-zoom="reset">Reset</button><button type="button" data-ea-zoom="in">+</button></div></div><div id="eaChipResearchTree" class="research-tree hidden"><div id="eaChipResearchWorld" class="research-tree-world"></div><div class="research-tree-controls"><button type="button" data-ea-zoom="out">−</button><button type="button" data-ea-zoom="reset">Reset</button><button type="button" data-ea-zoom="in">+</button></div></div><p id="eaResearchMessage" class="form-message"></p>';
  const tree=$('#cpuResearchTree');section.insertBefore(wrap,tree||null);
  wrap.querySelectorAll('[data-ea-research]').forEach(b=>b.addEventListener('click',()=>setResearchGroup(b.dataset.eaResearch)));
  setupResearchTreeNavigation($('#eaGpuResearchTree'));setupResearchTreeNavigation($('#eaChipResearchTree'));
 }
 wrap.classList.toggle('hidden',!isGpu());
 if(isGpu()){const eyebrow=section.querySelector('.company-section-heading .eyebrow');const heading=section.querySelector('.company-section-heading h4');const chip=section.querySelector('.company-count-chip');const description=section.querySelector('.company-section-heading p');if(eyebrow)eyebrow.textContent='GPU DEVELOPMENT';if(heading)heading.textContent='Research';if(description)description.textContent='Choose GPU or CHIP research, just like the CPU research section.';if(chip)chip.textContent='GPU / CHIP';renderResearchLists();}
}
function setResearchGroup(group){
 $('#eaGpuResearchTree')?.classList.toggle('hidden',group!=='GPU');
 $('#eaChipResearchTree')?.classList.toggle('hidden',group!=='CHIP');
 document.querySelectorAll('[data-ea-research]').forEach(b=>b.classList.toggle('active',b.dataset.eaResearch===group));
 renderResearchLists();
}
function mountGpuProductsPage(){
 const page=$('#page-company-products');if(!page)return;
 page.innerHTML='<div class="section-head"><div><div class="eyebrow purple-text">GPU MANUFACTURING</div><h3>Products</h3><p class="muted">Your GPU designs, drafts and published products.</p></div></div><div id="eaGpuProductList" class="ea-saved-chips"></div>';
}
function restoreCpuProductsPage(){
 const page=$('#page-company-products');if(!page)return;
 page.innerHTML='<div class="company-empty-page"><div class="eyebrow purple-text">COMPANY WORKSPACE</div><div class="company-empty-icon">▦</div><h3>Products</h3><p class="muted">Your manufactured products will appear here.</p></div>';
}
function hideGpuWorkspace(){
 $('#eaGpuPanel')?.classList.add('hidden');
 $('#eaCompanyResearch')?.classList.add('hidden');
 $('#cpuResearchTree')?.classList.remove('hidden');
 const section=$('#companyPanelResearch .research-section');if(section){const eyebrow=section.querySelector('.company-section-heading .eyebrow');const heading=section.querySelector('.company-section-heading h4');const chip=section.querySelector('.company-count-chip');if(eyebrow)eyebrow.textContent='CPU DEVELOPMENT';if(heading)heading.textContent='Research tree';const description=section.querySelector('.company-section-heading p');if(description)description.textContent='Unlock components before using them in your designs.';if(chip)chip.textContent='CPU RESEARCH';}
 $('#page-company-design #cpuDesigner')?.classList.remove('hidden');
 $('#page-company-design #companyDesignNoCompany')?.classList.toggle('hidden',!!currentCompany);
 restoreCpuProductsPage();
}
function showGpuMain(){
 if(!isGpu())return;
 $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');
 $('#page-company-design #cpuDesigner')?.classList.add('hidden');
 $('#eaGpuPanel')?.classList.remove('hidden');
 setGpuTab(activeGpuView);
 window.GpuDesigner3D?.mount($('#eaGpu3DStage'));
 window.GpuDesigner3D?.update?.({length:Number($('#eaGpuLength')?.value||300),width:Number($('#eaGpuWidth')?.value||125),body:$('#eaGpuBody')?.value||'plastic',shroud:$('#eaGpuShroud')?.value||'rounded',fans:gpuFans.map(f=>({...f})),rgb:!!$('#eaGpuRgb')?.checked,backplate:!!$('#eaGpuBackplate')?.checked,brand:$('#eaGpuBrand')?.value||'GRIND'});
 loadChips();drawGpu();
}
function syncCompanyDesignMode(){
 const visible=!$('#page-company-design')?.classList.contains('hidden');
 if(!currentCompany){$('#eaGpuPanel')?.classList.add('hidden');$('#page-company-design #cpuDesigner')?.classList.add('hidden');$('#page-company-design #companyDesignNoCompany')?.classList.remove('hidden');return;}
 if(isGpu()){
  $('#page-company-design #cpuDesigner')?.classList.add('hidden');
  $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');
  if(visible){mountGpuWorkspace();showGpuMain();}else $('#eaGpuPanel')?.classList.add('hidden');
 }else{
  $('#eaGpuPanel')?.classList.add('hidden');
  $('#page-company-design #companyDesignNoCompany')?.classList.add('hidden');
  $('#page-company-design #cpuDesigner')?.classList.remove('hidden');
 }
}
function setGpuTab(tab){
 document.querySelectorAll('[data-gpu-tab]').forEach(b=>b.classList.toggle('active',b.dataset.gpuTab===tab));
 activeGpuView=tab==='chips'?'chips':'design';
 const views={design:'#eaGpuDesign',chips:'#eaGpuChips'};Object.entries(views).forEach(([key,selector])=>$(selector)?.classList.toggle('hidden',key!==activeGpuView));
 if(activeGpuView==='chips')loadChips();
}
function researchNodeMarkup(r,x,y,icon,yes,locked){
 const status=yes?'UNLOCKED':locked?'LOCKED':'UNLOCK · $'+r.cost.toLocaleString();
 return '<button type="button" class="research-node '+(yes?'researched':locked?'prerequisite-locked':'available')+'" data-research-key="'+r.key+'" style="--node-x:'+x+'px;--node-y:'+y+'px" '+(yes||locked?'disabled':'')+'><span class="research-hex"><b>'+icon+'</b></span><strong>'+r.name+'</strong><small>$'+r.cost.toLocaleString()+' research · '+r.score+' Score</small><em class="research-node-status">'+status+'</em></button>';
}
function renderResearchLists(){
 const build=(group,worldId)=>{
  const world=$('#'+worldId);if(!world)return;
  const defs=GPU_RESEARCH.filter(r=>r.group===group);
  const coords=group==='GPU'?[[560,130],[280,410],[280,700],[560,410],[840,410],[840,700],[840,990]]:[[560,130],[300,390],[300,650],[300,910],[300,1170],[300,1430],[300,1690],[820,390],[820,650],[820,910],[820,1170]];
  const icons=group==='GPU'?['GPU','MB','CF','RGB','SF','MF']:['CHIP','1×','2×','3×','4×','6×','P1','P2','P3','P4'];
  const width=1120,height=group==='GPU'?1250:1900;
  const edges=group==='GPU'?[[0,1],[1,2],[0,3],[0,4],[4,5],[5,6]]:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[0,7],[7,8],[8,9],[9,10]];
  const paths=edges.map(([a,b])=>{const A=coords[a],B=coords[b],mid=(A[1]+B[1])/2;return '<path d="M'+A[0]+' '+(A[1]+65)+' L'+A[0]+' '+mid+' L'+B[0]+' '+mid+' L'+B[0]+' '+(B[1]-65)+'"/>';}).join('');
  world.style.width=width+'px';world.style.height=height+'px';
  world.innerHTML='<svg class="research-tree-lines" viewBox="0 0 '+width+' '+height+'">'+paths+'</svg>'+researchNodeMarkup({name:group==='GPU'?'Baseline GPU':'Baseline CHIP',cost:0,score:0,key:'baseline_'+group.toLowerCase()},560,130,group==='GPU'?'GPU':'CHIP',true,false)+defs.map((r,i)=>{const xy=coords[i+1],yes=researched(r.key),locked=!!(r.pre&&!researched(r.pre));return researchNodeMarkup(r,xy[0],xy[1],icons[i+1]||'UP',yes,locked);}).join('');
  world.querySelectorAll('[data-research-key]').forEach(b=>b.addEventListener('click',()=>unlockResearch(b.dataset.researchKey,group)));
 };
 build('GPU','eaGpuResearchWorld');build('CHIP','eaChipResearchWorld');
}
function setupResearchTreeNavigation(tree){
 if(!tree||tree.dataset.navigationReady)return;tree.dataset.navigationReady='1';
 const world=tree.querySelector('.research-tree-world');if(!world)return;
 let zoom=.72,panX=tree.clientWidth/2-560*zoom,panY=12,dragging=false,sx=0,sy=0,bx=0,by=0;
 const paint=()=>{world.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')';};
 tree.addEventListener('pointerdown',e=>{if(e.target.closest('button[data-research-key],.research-tree-controls'))return;dragging=true;sx=e.clientX;sy=e.clientY;bx=panX;by=panY;tree.classList.add('dragging');tree.setPointerCapture(e.pointerId);});
 tree.addEventListener('pointermove',e=>{if(!dragging)return;panX=bx+e.clientX-sx;panY=by+e.clientY-sy;paint();});
 const stop=()=>{dragging=false;tree.classList.remove('dragging');};tree.addEventListener('pointerup',stop);tree.addEventListener('pointercancel',stop);
 tree.querySelectorAll('[data-ea-zoom]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.eaZoom;if(a==='reset'){zoom=.72;panX=tree.clientWidth/2-560*zoom;panY=12;}else{const next=Math.max(.42,Math.min(1.35,zoom*(a==='in'?1.15:.87)));panX=panX*next/zoom;panY=panY*next/zoom;zoom=next;}paint();}));
 tree.addEventListener('wheel',e=>{if(!e.ctrlKey&&Math.abs(e.deltaY)<Math.abs(e.deltaX))return;e.preventDefault();const next=Math.max(.42,Math.min(1.35,zoom*(e.deltaY<0?1.08:.92)));panX=panX*next/zoom;panY=panY*next/zoom;zoom=next;paint();},{passive:false});
 paint();
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
 if(!currentCompany)return;
 optionsFor('#eaChipSpeed',['chip_ok_speed','chip_decent_speed','chip_good_speed','chip_fast_speed','chip_insane_speed','chip_super_speed']);
 optionsFor('#eaChipPower',['chip_decent_power','chip_good_power','chip_strong_power','chip_super_powerful']);
 const {data,error}=await sb.from('product_company_gpu_chips').select('*').eq('company_id',currentCompany.id).order('created_at',{ascending:false});
 const wrap=$('#eaSavedChips');if(error){if(wrap)wrap.textContent=error.message;return;}chips=data||[];
 const select=$('#eaGpuChipSelect');if(select)select.innerHTML='<option value="">Choose a saved chip</option>'+chips.map(c=>'<option value="'+c.id+'">'+esc(c.chip_name)+'</option>').join('');
 if(wrap)wrap.innerHTML=chips.map(c=>'<button class="ea-chip-card" data-chip-select="'+c.id+'"><span>▦</span><b>'+esc(c.chip_name)+'</b><small>'+esc(c.speed_level)+' · '+esc(c.power_level)+'</small></button>').join('')||'<p class="muted">No chips saved yet.</p>';
 wrap?.querySelectorAll('[data-chip-select]').forEach(b=>b.addEventListener('click',()=>{setGpuTab('design');$('#eaGpuChipSelect').value=b.dataset.chipSelect;}));
 optionsFor('#eaChipSpeed',['chip_ok_speed','chip_decent_speed','chip_good_speed','chip_fast_speed','chip_insane_speed','chip_super_speed']);
 optionsFor('#eaChipPower',['chip_decent_power','chip_good_power','chip_strong_power','chip_super_powerful']);
}
function readGpuLogo(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=256;c.height=256;const ctx=c.getContext('2d');const scale=Math.min(256/img.width,256/img.height);ctx.drawImage(img,(256-img.width*scale)/2,(256-img.height*scale)/2,img.width*scale,img.height*scale);gpuBrandLogo=c.toDataURL('image/webp',.78);drawGpu();};img.src=String(reader.result);};reader.readAsDataURL(file);}
function canvasPoint(e){const r=$('#eaGpuCanvas').getBoundingClientRect();return {x:(e.clientX-r.left)*900/r.width,y:(e.clientY-r.top)*480/r.height};}
function fanCoords(){const c=$('#eaGpuCanvas');const len=Number($('#eaGpuLength')?.value||300),w=Number($('#eaGpuWidth')?.value||125),scale=Math.min(1.6,Math.min(650/len,300/w)),gw=len*scale,gh=w*scale,x=(900-gw)/2,y=(480-gh)/2;return gpuFans.map(f=>({x:x+gw*f.position,y:y+gh/2,r:Math.min(gh*.34,gw/gpuFans.length*.34),type:f.type}));}
function nearestFan(x,y){const arr=fanCoords();let best=-1,dist=1e9;arr.forEach((p,i)=>{const d=Math.hypot(p.x-x,p.y-y);if(d<p.r*1.7&&d<dist){best=i;dist=d;}});return best;}
function drawGpu(){
 const body=$('#eaGpuBody')?.value||'plastic',rgb=$('#eaGpuRgb')?.checked||false;
 const len=Number($('#eaGpuLength')?.value||300),wid=Number($('#eaGpuWidth')?.value||125);
 const fans=gpuFans.map(f=>({position:f.position,type:f.type}));
 window.GpuDesigner3D?.update({length:len,width:wid,body,rgb,shroud:$('#eaGpuShroud')?.value||'rounded',backplate:$('#eaGpuBackplate')?.checked!==false,fans,brand:$('#eaGpuBrand')?.value||'GRIND'});
 $('#eaGpuFanCount').textContent=String(gpuFans.length);
 const bodyValue=body==='carbon'?4000:body==='metallic'?1200:0;
 const fanValue=gpuFans.reduce((sum,f)=>sum+(f.type==='gpu_smart_fans'?1400:f.type==='gpu_medium_fans'?200:80),0);
 const rgbValue=rgb?480:0,total=bodyValue+fanValue+rgbValue;
 $('#eaGpuCost').textContent='Estimated product value: $'+total.toLocaleString()+' · Body $'+bodyValue.toLocaleString()+' · Fans $'+fanValue.toLocaleString()+' · RGB $'+rgbValue.toLocaleString();
}
function renderGpuProducts(){
 const el=$('#eaGpuProductList');if(!el)return;
 const rows=(companyProducts||[]).filter(p=>p.product_line==='gpu');
 if(!rows.length){el.textContent='No GPU products yet. Create one in GPU Design.';return;}
 el.innerHTML='';
 rows.forEach(p=>{
  const card=document.createElement('article');card.className='ea-chip-card';
  const title=document.createElement('b');title.textContent=p.product_name;
  const status=document.createElement('small');status.textContent=(p.status==='published'?'Published':'Draft')+' · Value $'+Number(p.product_value||0).toLocaleString();
  const price=document.createElement('input');price.type='number';price.min='1';price.value=String(p.listed_price||1);
  const label=document.createElement('label');label.textContent='Listing price';label.appendChild(price);
  card.append(title,status,label);
  if(p.status==='draft'){const button=document.createElement('button');button.type='button';button.textContent='Publish product';button.addEventListener('click',async()=>{const amount=Number(price.value);if(amount<=0){toast('Enter a valid listing price.');return;}const result=await sb.rpc('update_cpu_product_listing',{p_product_id:p.id,p_listed_price:amount,p_publish:true});if(result.error){toast(result.error.message);return;}await loadCompanyResearchAndProducts();renderGpuProducts();toast('GPU published to Product Feed!');});card.appendChild(button);}
  el.appendChild(card);
 });
}
async function saveGpu(){
 const name=$('#eaGpuName').value.trim(),chipId=$('#eaGpuChipSelect').value,body=$('#eaGpuBody').value,rgb=$('#eaGpuRgb').checked;
 if(name.length<2||!chipId){$('#eaGpuMessage').textContent='Enter a name and choose a saved chip.';return;}
 if(body==='metallic'&&!researched('gpu_metallic_body')||body==='carbon'&&!researched('gpu_carbon_body')||rgb&&!researched('gpu_rgb')){toast('Research the selected GPU component first.');return;}
 const chip=chips.find(x=>x.id===chipId);if(!chip){await loadChips();$('#eaGpuMessage').textContent='Selected chip not found. Choose it again.';return;}
 const len=Number($('#eaGpuLength').value),wid=Number($('#eaGpuWidth').value),fanValue=gpuFans.reduce((sum,f)=>sum+(f.type==='gpu_smart_fans'?1400:f.type==='gpu_medium_fans'?200:f.type==='gpu_small_fans'?80:0),0),bodyValue=body==='carbon'?4000:body==='metallic'?1200:0,rgbValue=rgb?480:0,total=fanValue+bodyValue+rgbValue;
 const {error}=await sb.from('product_company_products').insert({company_id:currentCompany.id,owner_id:currentUser.id,product_line:'gpu',product_name:name,body_type:body,production_cost:total,product_value:total,listed_price:Math.max(1,Number($('#eaGpuPrice').value)||1),status:'draft',design_data:{chip_id:chip.id,chip_name:chip.chip_name,length:len,width:wid,fan_positions:gpuFans,fan_count:gpuFans.length,body,rgb,shroud:$('#eaGpuShroud').value,backplate:$('#eaGpuBackplate').checked,brand:$('#eaGpuBrand').value,brand_logo:gpuBrandLogo}});
 $('#eaGpuMessage').textContent=error?'Could not save GPU draft: '+error.message:'GPU saved as a draft. You can publish it later from Products.';
 if(!error){toast('GPU draft saved.');await loadCompanyResearchAndProducts();}
}

const originalPublishedFeed=window.loadPublishedProductFeed;
window.loadPublishedProductFeed=async function(){
 await originalPublishedFeed?.();
 if(!sb)return;
 const {data,error}=await sb.from('product_company_products').select('id,product_name,design_data,listed_price,product_value').eq('status','published').eq('product_line','gpu').order('created_at',{ascending:false}).limit(100);
 if(error||!data?.length)return;
 const grid=$('#publishedProductFeed');if(!grid)return;
 data.forEach(p=>{
  const card=[...grid.querySelectorAll('.published-product-card')].find(x=>x.querySelector('h4')?.textContent===p.product_name);
  if(!card)return;
  const visual=card.querySelector('.product-feed-cpu');
  if(visual){visual.className='product-feed-gpu';visual.innerHTML='<span>▰</span><b>'+esc(p.design_data?.brand||'GPU')+'</b><small>'+Number(p.design_data?.fan_count||0)+' FANS</small>';}
  const specs=card.querySelector('p');if(specs)specs.textContent=(p.design_data?.chip_name||'GPU Chip')+' · '+Number(p.design_data?.length||0)+' mm · '+Number(p.design_data?.width||0)+' mm';
 });
};
const originalLoad=window.loadCompanyDashboard;
window.loadCompanyDashboard=async function(){
 if(!currentUser||!sb)return;
 await refreshCompanies();
 const {data:invites}=await sb.from('product_company_transfers').select('id,company_id,sender_id,created_at,product_companies(company_name,logo_data_url)').eq('recipient_id',currentUser.id).eq('status','pending').order('created_at',{ascending:false}).limit(10);
 incomingCompanyTransfers=invites||[];renderCompanyIncomingTransfers?.();
 renderChooser();
 if(currentCompany){
  await loadCompanyResearchAndProducts();
  if(typeof renderCompanyDashboard==='function')renderCompanyDashboard();
  if(isGpu()){mountGpuWorkspace();mountGpuResearch();mountGpuProductsPage();renderGpuProducts();}
 }
};
const oldRender=window.renderCompanyDashboard;
window.renderCompanyDashboard=function(){
 oldRender?.();renderChooser();
 if(!currentCompany)return;
 const badge=$('.company-cpu-chip');if(badge)badge.textContent=isGpu()?'GPU MANUFACTURER':'CPU MANUFACTURER';
 addBackButton();
 if(isGpu()){
  mountGpuWorkspace();mountGpuResearch();mountGpuProductsPage();
  $('#eaCompanyResearch')?.classList.remove('hidden');
  $('#cpuResearchTree')?.classList.add('hidden');
 }else hideGpuWorkspace();
 syncCompanyDesignMode();
};
const oldShow=window.showPage;
window.showPage=function(page){
 if((page==='company-design'||page==='company-products')&&!currentCompany){oldShow?.('company');return;}
 oldShow?.(page);
 if(page==='company')renderChooser();
 if(page==='company-design'){
  if(isGpu()){mountGpuWorkspace();showGpuMain();}
  else{hideGpuWorkspace();$('#page-company-design #companyDesignNoCompany')?.classList.toggle('hidden',!!currentCompany);$('#page-company-design #cpuDesigner')?.classList.toggle('hidden',!currentCompany);}
 }
 if(page==='company-products'&&isGpu()){
  mountGpuProductsPage();renderGpuProducts();
 }
};
document.addEventListener('DOMContentLoaded',()=>{refreshCompanies();});
if(sb?.auth?.onAuthStateChange)sb.auth.onAuthStateChange(()=>{setTimeout(()=>refreshCompanies(),0);});
})()