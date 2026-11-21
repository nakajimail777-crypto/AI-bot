(() => {
  const modes = [
    ['seikanMode', '静観モード'],
    ['emotionFocus', '感情を感じきる'],
    ['returnPath', '戻れる逃げ道'],
    ['selfReturn', '自分に戻る'],
    ['skyGazing', '空を眺める'],
    ['blindSpot', '盲点を照らす'],
  ];
  const toggle = document.getElementById('talkToggle');
  const panel = document.getElementById('talkPanel');
  const summary = document.getElementById('talkActive');
  const shortcuts = [...document.querySelectorAll('[data-talk-shortcut]')];

  // Reuse the existing mode handlers so both entry points share all behavior.
  shortcuts.forEach(button => button.addEventListener('click', () => {
    const source = document.getElementById(button.dataset.talkShortcut);
    if (!source.disabled) source.click();
  }));

  toggle.addEventListener('click', () => {
    if (panel.open) return;
    panel.showModal();
    panel.querySelector('.talk-grid').scrollTop = 0;
    toggle.setAttribute('aria-expanded', 'true');
  });
  document.getElementById('talkClose').addEventListener('click', () => panel.close());
  // Native dialog supplies focus containment, Escape and return-to-opener behavior.
  panel.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));

  // This existing mode starts a reply immediately; show the conversation as it begins.
  document.getElementById('selfReturn').addEventListener('click', () => {
    if (document.getElementById('selfReturn').getAttribute('aria-pressed') !== 'true') return;
    panel.close();
    document.getElementById('messageInput').focus();
  });

  function sync() {
    shortcuts.forEach(button => {
      const source = document.getElementById(button.dataset.talkShortcut);
      button.setAttribute('aria-pressed', source.getAttribute('aria-pressed'));
      button.disabled = source.disabled;
    });
    const active = modes
      .filter(([id]) => document.getElementById(id).getAttribute('aria-pressed') === 'true')
      .map(([, name]) => name);
    summary.textContent = active.length ? '選択中：' + active.join('・') : '';
    summary.hidden = active.length === 0;
    toggle.title = active.length ? summary.textContent : '話し方を選ぶ';
  }
  const observer = new MutationObserver(sync);
  modes.forEach(([id]) => observer.observe(document.getElementById(id), {
    attributes: true, attributeFilter: ['aria-pressed', 'disabled'],
  }));
  sync();
})();
