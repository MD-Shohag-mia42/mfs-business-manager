// Bottom sheet on mobile, centered panel on desktop.
export function openSheet({ title = '', html = '' } = {}) {
  const root = document.getElementById('modal-root');
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-head">
        <h2 id="sheet-title"></h2>
        <button type="button" class="icon-btn" data-sheet-close aria-label="বন্ধ করুন">✕</button>
      </div>
      <div class="sheet-body">${html}</div>
    </div>`;
  overlay.querySelector('#sheet-title').textContent = title;

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const close = () => {
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = previousOverflow;
    overlay.remove();
    previouslyFocused?.focus?.();
  };

  // Escape closes the sheet, unless a confirm dialog is open on top of it
  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-overlay')) close();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-sheet-close]')) close();
  });

  document.addEventListener('keydown', onKey);
  root.appendChild(overlay);

  const sheet = overlay.querySelector('.sheet');
  sheet.setAttribute('tabindex', '-1');
  sheet.focus();

  return { el: overlay.querySelector('.sheet-body'), close };
}
