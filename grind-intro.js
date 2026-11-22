(() => {
  const overlay=document.getElementById('grindIntro');
  const playButton=document.getElementById('playIntroBtn');
  const skipButton=document.getElementById('grindIntroSkip');
  const studio=document.getElementById('grindIntroStudio');
  const canvas=document.getElementById('grindIntroParticles');
  if(!overlay||!playButton||!skipButton||!studio)return;
  let timers=[],running=false,audioCtx=null,master=null,raf=0,particles=[];
  const clearTimers=()=>{timers.forEach(clearTimeout);timers=[]};
  const schedule=(fn,ms)=>timers.push(setTimeout(fn,ms));
  function initParticles(){
    if(!canvas)return;
    const dpr=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;
    canvas.width=w*dpr;canvas.height=h*dpr;
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    particles=Array.from({length:150},()=>({x:Math.random()*w,y:Math.random()*h,z:.2+Math.random()*.8,r:.4+Math.random()*1.5,a:.15+Math.random()*.7,v:.12+Math.random()*.65}));
    cancelAnimationFrame(raf);
    const draw=()=>{if(!running)return;ctx.clearRect(0,0,w,h);for(const p of particles){p.y-=p.v*p.z;if(p.y< -5){p.y=h+5;p.x=Math.random()*w}ctx.beginPath();ctx.fillStyle='rgba(220,211,255,'+(p.a*p.z)+')';ctx.arc(p.x,p.y,p.r*p.z,0,Math.PI*2);ctx.fill()}raf=requestAnimationFrame(draw)};
    draw();
  }
  function tone(freq,start,duration,gain,type='sine',endFreq=freq){
    if(!audioCtx||!master)return;
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,start);o.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),start+duration);
    g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(gain,start+.08);g.gain.exponentialRampToValueAtTime(.0001,start+duration);
    o.connect(g);g.connect(master);o.start(start);o.stop(start+duration+.03);
  }
  function noise(start,duration,gain,filterFreq=900){
    if(!audioCtx||!master)return;
    const buffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*duration),audioCtx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);
    const src=audioCtx.createBufferSource(),filter=audioCtx.createBiquadFilter(),g=audioCtx.createGain();
    src.buffer=buffer;filter.type='lowpass';filter.frequency.setValueAtTime(filterFreq,start);filter.frequency.exponentialRampToValueAtTime(90,start+duration);
    g.gain.setValueAtTime(gain,start);g.gain.exponentialRampToValueAtTime(.0001,start+duration);
    src.connect(filter);filter.connect(g);g.connect(master);src.start(start);src.stop(start+duration);
  }
  function startAudio(){
    try{
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      audioCtx=audioCtx||new AC();audioCtx.resume();
      master=audioCtx.createGain();master.gain.value=.42;master.connect(audioCtx.destination);
      const t=audioCtx.currentTime;
      // Original synthesized cinematic score: evolving low drone, rising harmonic bed, impacts and final reveal.
      [55,82.41,110,164.81].forEach((f,i)=>tone(f,t+i*.12,18,.035,'sine',f*1.002));
      tone(110,t+.2,8,.045,'triangle',220);tone(164.81,t+3.2,8,.035,'sine',329.63);
      tone(220,t+6.1,7,.03,'triangle',440);noise(t+4.1,2.8,.045,650);noise(t+8.4,2.2,.05,1200);
      [0,1.5,3,4.5,6,7.5,9].forEach((v,i)=>tone(55+i*8,t+v,3,.018,'sine',70+i*12));
      // Transition swell and dramatic reveal hit, followed by a resonant tail.
      tone(65,t+10.4,5,.08,'sawtooth',130);noise(t+11.2,2.8,.075,1800);
      [110,164.81,220,329.63,440].forEach((f,i)=>tone(f,t+13.9,5.4,.042-i*.004,'sine',f*1.001));
      noise(t+14,3.2,.16,2600);tone(41.2,t+14,4.8,.15,'sine',41.2);
      tone(220,t+15.1,3.8,.045,'triangle',440);tone(329.63,t+15.25,3.5,.035,'sine',659.25);
      [0,.16,.32].forEach((v,i)=>tone(880-i*110,t+16.1+v,.9,.018,'sine',1320-i*120));
      tone(55,t+18,2,.06,'sine',55);
    }catch(e){/* Browser audio may be unavailable; visual intro still runs. */}
  }
  function stopAudio(){if(master&&audioCtx){const m=master;master=null;try{m.gain.setTargetAtTime(.0001,audioCtx.currentTime,.08);setTimeout(()=>{try{m.disconnect()}catch{}},450)}catch{}}}
  function finish(){
    if(!running)return;running=false;clearTimers();cancelAnimationFrame(raf);stopAudio();
    overlay.classList.add('is-closing');
    setTimeout(()=>{overlay.classList.add('hidden');overlay.classList.remove('is-closing','playing','is-transitioning','is-grind');overlay.setAttribute('aria-hidden','true');document.body.classList.remove('grind-intro-open')},680);
  }
  function play(){
    if(running)return;running=true;clearTimers();
    overlay.classList.remove('hidden','is-closing','is-transitioning','is-grind');overlay.classList.add('playing');overlay.setAttribute('aria-hidden','false');document.body.classList.add('grind-intro-open');
    void overlay.offsetWidth;studio.classList.remove('playing');void studio.offsetWidth;studio.classList.add('playing');
    initParticles();startAudio();
    schedule(()=>overlay.classList.add('is-transitioning'),11000);
    schedule(()=>{overlay.classList.remove('is-transitioning');overlay.classList.add('is-grind')},13000);
    schedule(finish,20000);
  }
  playButton.addEventListener('click',play);skipButton.addEventListener('click',finish);
  document.addEventListener('keydown',e=>{if(running&&e.key==='Escape')finish()});
  window.addEventListener('resize',()=>{if(running)initParticles()});
})();
