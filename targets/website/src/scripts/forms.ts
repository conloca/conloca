const WORKER_URL = (import.meta as { env?: { PUBLIC_WORKER_URL?: string } }).env?.PUBLIC_WORKER_URL ?? '/api/subscribe';

function setupForm(formId: string, msgId: string) {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  const msg = document.getElementById(msgId);
  if (!form || !msg) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const email = formData.get('email') as string;
    const intent = formData.get('intent') as string;
    const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = 'Please enter a valid email address.';
      msg.className = 'mt-3 text-sm text-red-400';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, intent }),
      });

      if (res.ok) {
        msg.textContent =
          intent === 'hosted' ? "You're on the list! We'll be in touch." : 'Subscribed! Check your inbox.';
        msg.className = 'mt-3 text-sm text-brand-400';
        form.reset();
      } else {
        throw new Error('Request failed');
      }
    } catch {
      msg.textContent = 'Something went wrong. Please try again.';
      msg.className = 'mt-3 text-sm text-red-400';
    } finally {
      btn.disabled = false;
      btn.textContent = intent === 'hosted' ? 'Join Waitlist' : 'Subscribe';
    }
  });
}

setupForm('waitlist-form', 'waitlist-msg');
setupForm('newsletter-form', 'newsletter-msg');
