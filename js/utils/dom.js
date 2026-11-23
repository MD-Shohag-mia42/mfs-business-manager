export function setLoading(button, on) {
  if (!button) return;
  button.disabled = on;
  button.classList.toggle('is-loading', on);
  button.setAttribute('aria-busy', String(on));
}
