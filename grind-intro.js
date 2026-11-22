(() => {
  const overlay = document.getElementById('grindIntro');
  const playButton = document.getElementById('playIntroBtn');
  const skipButton = document.getElementById('grindIntroSkip');
  const studio = document.getElementById('grindIntroStudio');
  if (!overlay || !playButton || !skipButton || !studio) return;

  let timers = [];
  let running = false;
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const finish = () => {
    if (!running) return;
    running = false;
    clearTimers();
    overlay.classList.add('is-closing');
    window.setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('is-closing', 'playing', 'is-transitioning', 'is-grind');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('grind-intro-open');
    }, 680);
  };
  const schedule = (fn, delay) => timers.push(window.setTimeout(fn, delay));
  const play = () => {
    if (running) return;
    running = true;
    clearTimers();
    overlay.classList.remove('hidden', 'is-closing', 'is-transitioning', 'is-grind');
    overlay.classList.add('playing');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('grind-intro-open');
    void overlay.offsetWidth;
    studio.classList.remove('playing');
    void studio.offsetWidth;
    studio.classList.add('playing');

    schedule(() => overlay.classList.add('is-transitioning'), 3300);
    schedule(() => {
      overlay.classList.remove('is-transitioning');
      overlay.classList.add('is-grind');
    }, 4150);
    schedule(finish, 6900);
  };

  playButton.addEventListener('click', play);
  skipButton.addEventListener('click', finish);
  document.addEventListener('keydown', event => {
    if (running && event.key === 'Escape') finish();
  });
})();
