import { signIn } from '../services/auth.js';
import { toast } from '../components/toast.js';
import { setLoading } from '../utils/dom.js';

export function renderLoginPage(root) {
  root.innerHTML = `
    <div class="auth-wrap">
      <form class="card auth-card" id="login-form" novalidate>
        <div class="brand" style="margin-bottom:20px">
          <span class="brand-mark">৳</span>
          <div>
            <h1>MFS Business Manager</h1>
            <p class="muted">Admin login</p>
          </div>
        </div>

        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" inputmode="email"
                 autocomplete="username" required>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password"
                 autocomplete="current-password" required>
        </div>

        <p class="form-error" id="login-error" role="alert" hidden style="margin-top:14px"></p>

        <button class="btn btn-primary btn-block" id="login-btn" type="submit"
                style="margin-top:18px">Login</button>
      </form>
    </div>`;

  const form = root.querySelector('#login-form');
  const btn = root.querySelector('#login-btn');
  const errEl = root.querySelector('#login-error');
  let busy = false;

  const showError = (msg) => {
    errEl.textContent = msg;
    errEl.hidden = false;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return; // block double submit

    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (!email || !password) return showError('Email ও password দুটোই দিন।');

    busy = true;
    errEl.hidden = true;
    setLoading(btn, true);

    try {
      await signIn(email, password);
      toast('Login সফল হয়েছে', 'success');
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('Invalid login credentials')) {
        showError('Email বা password ভুল।');
      } else if (msg.includes('Email not confirmed')) {
        showError('Email এখনো confirm করা হয়নি।');
      } else {
        showError('Login করা যায়নি। ইন্টারনেট ও Supabase config দেখুন।');
      }
    } finally {
      busy = false;
      setLoading(btn, false);
    }
  });
}
