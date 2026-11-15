(() => {
  function create({ onStart, onFinish, onFeedback }) {
    const byId = id => document.getElementById(id);
    const dialog = byId('deepThemeDialog');
    const form = byId('deepThemeForm');
    const custom = byId('deepThemeCustom');
    const submit = byId('submitDeepTheme');
    const feedback = byId('deepFeedback');
    let state = { active: false, theme: '', canStart: false, canSend: false, busy: false, feedback: false, hasContext: false };
    let opener = null;
    let returnFocus = true;

    function selection() {
      return form.querySelector('input[name="deepThemeChoice"]:checked')?.value || null;
    }
    function themeValue() {
      const value = selection();
      return value === 'custom' ? custom.value.trim() : value === 'current' ? '' : value;
    }
    function showError(message = '') {
      byId('deepThemeError').textContent = message;
      byId('deepThemeError').hidden = !message;
      custom.setAttribute('aria-invalid', String(!!message));
    }
    function syncSelection() {
      const value = selection();
      const isCustom = value === 'custom';
      byId('deepThemeCustomField').hidden = !isCustom;
      submit.disabled = !state.canStart || state.busy || !value || (isCustom && !custom.value.trim()) || (value === 'current' && !state.hasContext);
    }
    function close() {
      if (dialog.open) dialog.close();
    }
    function open({ hasContext = state.hasContext } = {}) {
      if (!state.canStart || state.busy) return false;
      state.hasContext = !!hasContext;
      opener = document.activeElement;
      returnFocus = true;
      form.reset();
      showError();
      byId('deepThemeCurrent').disabled = !state.hasContext;
      byId('deepThemeCurrentOption').hidden = !state.hasContext;
      syncSelection();
      if (!dialog.open) dialog.showModal();
      return true;
    }
    function update(next) {
      state = { ...state, ...next };
      const entry = byId('startDeepExploration');
      if (entry) entry.disabled = !state.canStart || state.busy;
      byId('deepFinish').hidden = !state.active;
      byId('deepFinish').disabled = !state.active || !state.canSend || state.busy;
      feedback.hidden = !state.active || !state.feedback;
      feedback.querySelectorAll('button').forEach(button => { button.disabled = !state.canSend || state.busy; });
      byId('deepThemeCurrent').disabled = !state.hasContext;
      byId('deepThemeCurrentOption').hidden = !state.hasContext;
      syncSelection();
    }

    document.addEventListener('click', event => {
      if (event.target.closest?.('#startDeepExploration')) open();
    });
    byId('closeDeepTheme').addEventListener('click', close);
    byId('cancelDeepTheme').addEventListener('click', close);
    dialog.addEventListener('close', () => { if (returnFocus && opener?.isConnected) opener.focus(); });
    form.addEventListener('change', event => {
      showError();
      syncSelection();
      if (event.target.id === 'deepThemeFree') custom.focus();
    });
    custom.addEventListener('input', () => { showError(); syncSelection(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!state.canStart || state.busy) return;
      const theme = themeValue();
      if (theme === null || (selection() === 'current' && !state.hasContext)) return;
      if (selection() === 'custom' && (!theme || theme.length > 80 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(theme))) {
        showError('テーマを1〜80文字の短い言葉で書き直してください。改行や見えない制御文字は使えません。');
        custom.focus();
        return;
      }
      returnFocus = false;
      close();
      onStart(theme);
    });
    byId('deepFinish').addEventListener('click', () => {
      if (state.active && state.canSend && !state.busy) onFinish();
    });
    feedback.addEventListener('click', event => {
      const button = event.target.closest?.('[data-deep-feedback]');
      if (button && !button.disabled && state.active && state.feedback && state.canSend && !state.busy) onFeedback(button.dataset.deepFeedback);
    });
    update(state);
    return { open, close, update };
  }
  globalThis.DragonDeepExploration = { create };
})();
