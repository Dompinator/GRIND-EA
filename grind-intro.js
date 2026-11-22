(() => {
  const overlay=document.getElementById('grindIntro');
  const playButton=document.getElementById('playIntroBtn');
  const skipButton=document.getElementById('grindIntroSkip');
  const studio=document.getElementById('grindIntroStudio');
  const canvas=document.getElementById('grindIntroParticles');
  const chapters=[...overlay.querySelectorAll('[data-intro-chapter]')];
  if(!overlay||!playButton||!skipButton||!studio)return;
  let timers=[],running=false,audioCtx=null,master=null,raf=0,particles=[];
  const clearTimers=()=>{timers.forEach(clearTimeout);timers=[]};
  const schedule=(fn,ms)=>timers.push(setTimeout(fn,ms));
  function initParticles(){
    if(!canvas)return;
    const dpr=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;
    canvas.width=w*dpr;canvas.height=h*dpr;
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    particles=Array.from({length:240},()=>({x:Math.random()*w,y:Math.random()*h,z:.2+Math.random()*.8,r:.4+Math.random()*1.5,a:.15+Math.random()*.7,v:1.1+Math.random()*3.8}));
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
      tone(110,t+.15,5.2,.07,'triangle',246.94);tone(164.81,t+1.4,5.1,.055,'sine',392);tone(220,t+2.7,4.5,.05,'triangle',523.25);
      tone(220,t+6.1,7,.03,'triangle',440);noise(t+1.7,1.8,.075,950);noise(t+3.6,1.8,.095,1500);noise(t+5.1,1.1,.13,2300);
      [0,.55,1.1,1.65,2.2,2.75,3.3,3.85,4.4,4.95].forEach((v,i)=>{tone(55+i*3,t+v,1.1,.025,'sine',82+i*9);noise(t+v,.22,.018,500+i*160)});
      // Transition swell and dramatic reveal hit, followed by a resonant tail.
      tone(48,t+5.1,2.2,.14,'sawtooth',180);noise(t+5.25,1.5,.19,2600);
      [110,164.81,220,329.63,440,523.25,659.25].forEach((f,i)=>tone(f,t+6.85,4.8,.055-i*.005,'sine',f*1.001));
      noise(t+6.9,2.1,.23,3200);tone(41.2,t+6.9,4.8,.2,'sine',41.2);
      tone(220,t+7.1,3.8,.065,'triangle',440);tone(329.63,t+7.25,3.5,.055,'sine',659.25);
      [0,.12,.24,.36,.48].forEach((v,i)=>tone(880-i*90,t+8.2+v,.9,.025,'sine',1320-i*120));
      tone(55,t+9.5,4,.075,'sine',55);
    }catch(e){/* Browser audio may be unavailable; visual intro still runs. */}
  }
  function stopAudio(){if(master&&audioCtx){const m=master;master=null;try{m.gain.setTargetAtTime(.0001,audioCtx.currentTime,.08);setTimeout(()=>{try{m.disconnect()}catch{}},450)}catch{}}}
  function showChapter(index){chapters.forEach((el,i)=>{el.classList.remove('active','leaving');if(i===index){void el.offsetWidth;el.classList.add('active')}else if(i<index)el.classList.add('leaving')});}
  function finish(){
    if(!running)return;running=false;clearTimers();cancelAnimationFrame(raf);stopAudio();
    overlay.classList.add('is-closing');
    setTimeout(()=>{overlay.classList.add('hidden');overlay.classList.remove('is-closing','playing','is-transitioning','is-grind');studio.classList.remove('is-gone','playing');chapters.forEach(el=>el.classList.remove('active','leaving'));overlay.setAttribute('aria-hidden','true');document.body.classList.remove('grind-intro-open')},680);
  }
  function play(){
    if(running)return;running=true;clearTimers();
    overlay.classList.remove('hidden','is-closing','is-transitioning','is-grind');chapters.forEach(el=>el.classList.remove('active','leaving'));overlay.classList.add('playing');overlay.setAttribute('aria-hidden','false');document.body.classList.add('grind-intro-open');
    void overlay.offsetWidth;studio.classList.remove('playing','is-gone');void studio.offsetWidth;studio.classList.add('playing');
    initParticles();startAudio();
    schedule(()=>overlay.classList.add('is-transitioning'),10500);
    schedule(()=>{studio.classList.add('is-gone');overlay.classList.remove('is-transitioning');overlay.classList.add('is-grind')},12000);
    schedule(()=>showChapter(0),14500);
    schedule(()=>showChapter(1),19500);
    schedule(()=>showChapter(2),25000);
    schedule(()=>showChapter(3),30500);
    schedule(()=>showChapter(4),36000);
  }
  playButton.addEventListener('click',play);skipButton.addEventListener('click',finish);
  document.addEventListener('keydown',e=>{if(running&&e.key==='Escape')finish()});
  window.addEventListener('resize',()=>{if(running)initParticles()});
})();
