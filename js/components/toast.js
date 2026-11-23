export function toast(message, type = 'info', duration = 3500) {
  const root = document.getElementById('toast-root');
  if (!root) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  root.appendChild(el);

  setTimeout(() => el.remove(), duration);
}
