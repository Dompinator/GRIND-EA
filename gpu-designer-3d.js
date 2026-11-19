/* GRIND-EA · Procedural 3D GPU CAD editor */
(function(){
'use strict';
let THREE=null,renderer=null,scene=null,camera=null,controls=null,root=null,stage=null,observer=null,raf=0,drag=null,config={};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
async function init(){
 if(THREE)return true;
 try{const m=await import('three');THREE=m;return true;}catch(e){console.error('GPU 3D editor could not load Three.js',e);return false;}
}
function mat(color,metalness=.25,roughness=.42,emissive=null){
 return new THREE.MeshStandardMaterial({color,metalness,roughness,emissive:emissive||0x000000,emissiveIntensity:.65});
}
function box(parent,w,h,d,material,x=0,y=0,z=0,bevel=0){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function buildFan(parent,x,z,r,glow){
 const housing=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.09,64),mat(0x10131b,.65,.28));housing.rotation.x=Math.PI/2;housing.position.set(x,.19,z);housing.castShadow=true;parent.add(housing);
 const ring=new THREE.Mesh(new THREE.TorusGeometry(r*.91,.035,12,64),mat(glow?0x9c5cff:0x8993a2,.72,.25,glow?0x6d28d9:0x000000));ring.rotation.x=Math.PI/2;ring.position.set(x,.245,z);parent.add(ring);
 const rotor=new THREE.Group();rotor.position.set(x,.255,z);parent.add(rotor);
 const bladeMat=mat(0x707b8b,.62,.32);
 for(let i=0;i<9;i++){const blade=new THREE.Mesh(new THREE.BoxGeometry(r*.19,.025,r*.72),bladeMat);blade.position.set(Math.cos(i*Math.PI*2/9)*r*.36,0,Math.sin(i*Math.PI*2/9)*r*.36);blade.rotation.y=-i*Math.PI*2/9-.45;blade.castShadow=true;rotor.add(blade);}
 const hub=new THREE.Mesh(new THREE.CylinderGeometry(r*.23,r*.23,.07,32),mat(0xc0c6d0,.82,.22));hub.rotation.x=Math.PI/2;hub.position.y=.02;rotor.add(hub);
 const logo=new THREE.Mesh(new THREE.CircleGeometry(r*.13,32),mat(0x252b36,.55,.28));logo.rotation.x=-Math.PI/2;logo.position.y=.06;rotor.add(logo);
}
function buildModel(){
 if(!THREE||!root)return;
 while(root.children.length){const o=root.children.pop();o.traverse?.(n=>{n.geometry?.dispose?.();if(Array.isArray(n.material))n.material.forEach(m=>m.dispose?.());else n.material?.dispose?.();});}
 const length=clamp(Number(config.length||300)/300,.72,1.4),width=clamp(Number(config.width||125)/125,.78,1.42);
 const w=2.7*length,d=1.12*width,body=config.body||'plastic',shape=config.shroud||'rounded',rgb=!!config.rgb;
 const bodyColor=body==='carbon'?0x171b22:body==='metallic'?0x7f8997:0x343744;
 const shroudMat=mat(bodyColor,.68,.3,rgb?0x30105c:0x000000);
 const pcbMat=mat(0x172b25,.28,.65),dark=mat(0x11151d,.58,.36),metal=mat(0x9da8b6,.8,.25),gold=mat(0xc7a45b,.8,.25);
 // PCB and edge connector
 box(root,w+.16,.12,d+.12,pcbMat,0,-.12,0);
 box(root,w*.92,.055,.2,gold,0,-.205,d*.52);
 // GPU shroud body and upper rim
 const shroud=box(root,w,.24,d,shroudMat,0,.04,0);
 if(shape==='rounded'){shroud.geometry.dispose();shroud.geometry=new THREE.BoxGeometry(w,.24,d);shroud.scale.set(1,1,1);}
 box(root,w*.94,.08,d*.94,dark,0,.19,0);
 // Fan positions and frame
 const fans=Array.isArray(config.fans)?config.fans:[{position:.28},{position:.72}];
 const fanCount=clamp(fans.length||2,1,6),radius=Math.min(d*.34,w/(fanCount*2.15));
 fans.forEach((f,i)=>buildFan(root,-w/2+w*clamp(Number(f.position??((i+.5)/fanCount)),.08,.92),0,radius,rgb));
 // Side rails, vents and heat pipes
 for(let side of [-1,1]){
  box(root,w*.86,.07,.055,metal,0,.13,side*d*.49);
  for(let i=0;i<9;i++)box(root,.035,.025,d*.18,dark,-w*.4+i*w*.1,.18,side*d*.36);
 }
 for(let i=0;i<3;i++){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,w*.66,16),mat(0xb77b3d,.82,.25));pipe.rotation.z=Math.PI/2;pipe.position.set(0,-.005,-d*.29+i*d*.29);root.add(pipe);}
 // Backplate
 if(config.backplate!==false){box(root,w*.94,.07,d*.94,body==='carbon'?mat(0x20252e,.7,.27):mat(0x626b79,.72,.3),0,-.205,0);for(let i=0;i<6;i++)box(root,.018,.012,d*.66,dark,-w*.36+i*w*.145,-.164,0);}
 // I/O bracket with display port cutout details
 box(root,.12,.55,d*.9,metal,-w/2-.08,-.02,0);
 for(let i=0;i<3;i++)box(root,.035,.08,.13,dark,-w/2-.15,.11,-d*.27+i*d*.27);
 // Branding plate
 box(root,w*.34,.025,.19,mat(0x202431,.55,.3),0,.205,d*.38);
 // Small screws and component details
 for(let x of [-w*.43,w*.43])for(let z of [-d*.4,d*.4]){const screw=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.018,16),gold);screw.position.set(x,.215,z);root.add(screw);}
}
async function mount(el){
 if(!el)return;stage=el;
 if(!(await init())){el.innerHTML='<div class="gpu-3d-error">3D GPU editor could not initialize. Refresh the page and try again.</div>';return;}
 if(renderer){if(renderer.domElement.parentNode!==el)el.appendChild(renderer.domElement);resize();return;}
 scene=new THREE.Scene();scene.background=new THREE.Color(0x0b0b13);
 camera=new THREE.PerspectiveCamera(36,1,.1,100);camera.position.set(4.2,3.1,4.8);
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;el.appendChild(renderer.domElement);
 scene.add(new THREE.HemisphereLight(0xdbe5ff,0x20202b,2.1));
 const key=new THREE.DirectionalLight(0xffffff,3.2);key.position.set(3,6,4);key.castShadow=true;scene.add(key);
 const rim=new THREE.DirectionalLight(0x9c62ff,2.2);rim.position.set(-4,3,-3);scene.add(rim);
 const floor=new THREE.Mesh(new THREE.CircleGeometry(5,64),new THREE.MeshStandardMaterial({color:0x15131d,roughness:.82,metalness:.15}));floor.rotation.x=-Math.PI/2;floor.position.y=-.55;floor.receiveShadow=true;scene.add(floor);
 root=new THREE.Group();root.position.y=.05;scene.add(root);
 const grid=new THREE.GridHelper(8,32,0x49365f,0x292333);grid.position.y=-.54;scene.add(grid);
 let yaw=-.45,pitch=.45,dist=6.2;
 const render=()=>{raf=requestAnimationFrame(render);if(root)root.rotation.y+=0.0008;renderer.render(scene,camera);};render();
 const onDown=e=>{drag={x:e.clientX,y:e.clientY,yaw,pitch};el.setPointerCapture?.(e.pointerId);};
 const onMove=e=>{if(!drag)return;yaw=drag.yaw+(e.clientX-drag.x)*.009;pitch=clamp(drag.pitch+(e.clientY-drag.y)*.008,-.25,1.15);camera.position.set(Math.sin(yaw)*dist,Math.max(1.1,Math.sin(pitch)*dist),Math.cos(yaw)*dist);camera.lookAt(0,0,0);};
 const onUp=()=>drag=null;el.addEventListener('pointerdown',onDown);el.addEventListener('pointermove',onMove);el.addEventListener('pointerup',onUp);el.addEventListener('pointercancel',onUp);
 el.addEventListener('wheel',e=>{e.preventDefault();dist=clamp(dist+Math.sign(e.deltaY)*.35,3.7,9);camera.position.set(Math.sin(yaw)*dist,Math.max(1.1,Math.sin(pitch)*dist),Math.cos(yaw)*dist);camera.lookAt(0,0,0);},{passive:false});
 observer=new ResizeObserver(resize);observer.observe(el);resize();buildModel();
}
function resize(){if(!renderer||!stage)return;const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
function update(next){config={...config,...next};if(!renderer){if(stage)mount(stage).then(()=>buildModel());return;}buildModel();}
function dispose(){if(raf)cancelAnimationFrame(raf);observer?.disconnect();renderer?.dispose();renderer=null;scene=null;camera=null;root=null;THREE=null;}
window.GpuDesigner3D={mount,update,dispose};
})();