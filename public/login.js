const form = document.getElementById('login');
const error = document.getElementById('login-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'x-app': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ password: form.password.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not sign in.');
    location.href = '/';
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    form.password.select();
  } finally {
    button.disabled = false;
  }
});
