export function confirmDialog({
  title = 'নিশ্চিত?',
  message = '',
  confirmText = 'হ্যাঁ',
  cancelText = 'বাতিল',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const previouslyFocused = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true"
           aria-labelledby="modal-title" aria-describedby="modal-msg">
        <h2 id="modal-title"></h2>
        <p id="modal-msg" class="muted"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel"></button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok"></button>
        </div>
      </div>`;

    // textContent keeps any dynamic text safe from HTML injection
    overlay.querySelector('#modal-title').textContent = title;
    overlay.querySelector('#modal-msg').textContent = message;
    overlay.querySelector('[data-act="cancel"]').textContent = cancelText;
    overlay.querySelector('[data-act="ok"]').textContent = confirmText;

    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      previouslyFocused?.focus?.();
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') close(true);
      if (act === 'cancel') close(false);
    });

    document.addEventListener('keydown', onKey);
    root.appendChild(overlay);
    overlay.querySelector('[data-act="cancel"]').focus();
  });
}
