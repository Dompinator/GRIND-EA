(() => {
  const overlay=document.getElementById('grindIntro');
  const playButton=document.getElementById('playIntroBtn');
  const skipButton=document.getElementById('grindIntroSkip');
  const studio=document.getElementById('grindIntroStudio');
  const canvas=document.getElementById('grindIntroParticles');
  if(!overlay||!playButton||!skipButton||!studio)return;
  const chapters=[...overlay.querySelectorAll('[data-intro-chapter]')];
  let timers=[],running=false,audioCtx=null,master=null,raf=0,particles=[];
  const clearTimers=()=>{timers.forEach(clearTimeout);timers=[]};
  const schedule=(fn,ms)=>timers.push(setTimeout(fn,ms));
  function initParticles(){
    if(!canvas)return;
    const dpr=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;
    canvas.width=w*dpr;canvas.height=h*dpr;
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    particles=Array.from({length:210},()=>({x:Math.random()*w,y:Math.random()*h,z:.2+Math.random()*.8,r:.4+Math.random()*1.5,a:.15+Math.random()*.7,v:1.2+Math.random()*4.2}));
    cancelAnimationFrame(raf);
    const draw=()=>{if(!running)return;ctx.clearRect(0,0,w,h);for(const p of particles){p.y-=p.v*p.z;if(p.y< -5){p.y=h+5;p.x=Math.random()*w}ctx.beginPath();ctx.fillStyle='rgba(220,211,255,'+(p.a*p.z)+')';ctx.arc(p.x,p.y,p.r*p.z,0,Math.PI*2);ctx.fill()}raf=requestAnimationFrame(draw)};
    draw();
  }
  function osc(freq,at,dur,vol,wave='sine',end=freq){
    if(!audioCtx||!master)return;
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type=wave;o.frequency.setValueAtTime(Math.max(1,freq),at);
    if(end!==freq)o.frequency.exponentialRampToValueAtTime(Math.max(1,end),at+dur);
    g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(Math.max(.0002,vol),at+.018);g.gain.exponentialRampToValueAtTime(.0001,at+dur);
    o.connect(g);g.connect(master);o.start(at);o.stop(at+dur+.03);
  }
  function sweep(at,dur,vol,cutoff=2200){
    if(!audioCtx||!master)return;
    const len=Math.max(1,Math.floor(audioCtx.sampleRate*dur)),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),data=buf.getChannelData(0);
    for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);
    const src=audioCtx.createBufferSource(),filter=audioCtx.createBiquadFilter(),g=audioCtx.createGain();
    src.buffer=buf;filter.type='lowpass';filter.frequency.setValueAtTime(cutoff,at);filter.frequency.exponentialRampToValueAtTime(100,at+dur);
    g.gain.setValueAtTime(vol,at);g.gain.exponentialRampToValueAtTime(.0001,at+dur);
    src.connect(filter);filter.connect(g);g.connect(master);src.start(at);src.stop(at+dur);
  }
  function kick(at){
    if(!audioCtx||!master)return;
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type='sine';o.frequency.setValueAtTime(125,at);o.frequency.exponentialRampToValueAtTime(42,at+.18);
    g.gain.setValueAtTime(.0001,at);g.gain.linearRampToValueAtTime(.24,at+.008);g.gain.exponentialRampToValueAtTime(.0001,at+.24);
    o.connect(g);g.connect(master);o.start(at);o.stop(at+.25);
  }
  function noiseHit(at,dur,vol,highpass=1800){
    if(!audioCtx||!master)return;
    const len=Math.floor(audioCtx.sampleRate*dur),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),data=buf.getChannelData(0);
    for(let i=0;i<len;i++)data[i]=Math.random()*2-1;
    const src=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();
    f.type='highpass';f.frequency.value=highpass;g.gain.setValueAtTime(vol,at);g.gain.exponentialRampToValueAtTime(.0001,at+dur);
    src.buffer=buf;src.connect(f);f.connect(g);g.connect(master);src.start(at);src.stop(at+dur);
  }
  function startAudio(){
    try{
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      audioCtx=audioCtx||new AC();audioCtx.resume();
      master=audioCtx.createGain();master.gain.value=.48;master.connect(audioCtx.destination);
      const t=audioCtx.currentTime;
      // Slow, spacious studio ident; the score deliberately changes gear after the GRIND reveal.
      [55,82.41,110,164.81].forEach((f,i)=>osc(f,t+i*.16,13,.025,'sine',f*1.002));
      osc(110,t+.4,5,.055,'triangle',246.94);osc(164.81,t+2,5,.05,'sine',392);
      sweep(t+3,2.4,.08,1300);sweep(t+7,2,.12,2200);
      osc(48,t+11,2.2,.17,'sawtooth',180);sweep(t+11.2,1.4,.19,2800);
      [110,164.81,220,329.63,440,523.25,659.25].forEach((f,i)=>osc(f,t+13.4,4,.052-i*.004,'sine',f*1.001));
      noiseHit(t+13.45,1.6,.2,250);
      // Up-tempo original synthesized electro/launch groove: 124 BPM, punchy kick, claps, hats and bright chord stabs.
      const beat=60/124,bar=beat*4,grooveStart= t+15.8,grooveEnd=t+54;
      const chordSets=[[146.83,185,220],[130.81,164.81,196],[110,146.83,174.61],[123.47,155.56,185]];
      for(let b=0;grooveStart+b*bar<grooveEnd;b++){
        const bt=grooveStart+b*bar,notes=chordSets[b%chordSets.length];
        notes.forEach((n,i)=>osc(n,bt+i*.025,1.05,.026,'sawtooth',n*1.002));
        for(let step=0;step<8;step++){
          const at=bt+step*beat/2;
          if(step%2===0)kick(at);
          else osc(55,at,.12,.045,'sine',42);
          if(step===2||step===6)noiseHit(at,.13,.085,900);
          noiseHit(at+beat/4,.045,.022,6500);
          if(step===0||step===4)osc(440,at,.16,.018,'triangle',660);
        }
        osc(587.33,bt+beat*2,.18,.028,'triangle',783.99);
        osc(739.99,bt+beat*3,.16,.022,'triangle',987.77);
      }
    }catch(e){/* Visual presentation remains available if browser audio is blocked. */}
  }
  function stopAudio(){
    if(master&&audioCtx){const m=master;master=null;try{m.gain.setTargetAtTime(.0001,audioCtx.currentTime,.08);setTimeout(()=>{try{m.disconnect()}catch{}},450)}catch{}}
  }
  function showChapter(index){
    overlay.classList.add('is-showcase');
    chapters.forEach((el,i)=>{el.classList.remove('active','leaving');if(i===index){void el.offsetWidth;el.classList.add('active')}else if(i<index)el.classList.add('leaving')});
  }
  function finish(){
    if(!running)return;running=false;clearTimers();cancelAnimationFrame(raf);stopAudio();
    overlay.classList.add('is-closing');
    setTimeout(()=>{overlay.classList.add('hidden');overlay.classList.remove('is-closing','playing','is-transitioning','is-grind','is-showcase');studio.classList.remove('is-gone','playing');chapters.forEach(el=>el.classList.remove('active','leaving'));overlay.setAttribute('aria-hidden','true');document.body.classList.remove('grind-intro-open')},680);
  }
  function play(){
    if(running)return;running=true;clearTimers();
    overlay.classList.remove('hidden','is-closing','is-transitioning','is-grind','is-showcase');
    chapters.forEach(el=>el.classList.remove('active','leaving'));
    overlay.classList.add('playing');overlay.setAttribute('aria-hidden','false');document.body.classList.add('grind-intro-open');
    void overlay.offsetWidth;studio.classList.remove('playing','is-gone');void studio.offsetWidth;studio.classList.add('playing');
    initParticles();startAudio();
    // Give the studio identity a proper long, legible hold before the transition.
    schedule(()=>overlay.classList.add('is-transitioning'),11500);
    schedule(()=>{studio.classList.add('is-gone');overlay.classList.remove('is-transitioning');overlay.classList.add('is-grind')},12800);
    // Grand reveal lands; immediately hand off to the faster, upbeat feature film.
    schedule(()=>{overlay.classList.add('is-showcase');showChapter(0)},16300);
    const chapterStart=16300,chapterDuration=4100;
    for(let i=1;i<chapters.length;i++)schedule(()=>showChapter(i),chapterStart+i*chapterDuration);
    // Final chapter remains on screen until Skip / Escape; no arbitrary auto-close.
  }
  playButton.addEventListener('click',play);skipButton.addEventListener('click',finish);
  document.addEventListener('keydown',e=>{if(running&&e.key==='Escape')finish()});
  window.addEventListener('resize',()=>{if(running)initParticles()});
})();