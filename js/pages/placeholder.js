import { escapeHtml } from '../utils/format.js';

export function placeholderPage(title, step) {
  return (view) => {
    view.innerHTML = `
      <div class="empty-state">
        <h2>${escapeHtml(title)}</h2>
        <p class="muted">এই পেজ ধাপ ${step}-এ যোগ হবে।</p>
      </div>`;
  };
}
