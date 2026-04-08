const WORKER_URL = '/api/subscribe';

function setMessage(messageElement: HTMLElement, text: string, className: string) {
  messageElement.textContent = text;
  messageElement.className = className;
}

function setupForm(form: HTMLFormElement) {
  const messageElement = form.parentElement?.querySelector<HTMLElement>('[data-subscribe-message]');
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const successMessage = form.dataset.subscribeSuccessMessage;

  if (!messageElement || !submitButton || form.dataset.subscribeBound === 'true') return;

  form.dataset.subscribeBound = 'true';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get('email') ?? '').trim();
    const intent = String(formData.get('intent') ?? 'newsletter');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage(messageElement, 'Please enter a valid email address.', 'mt-3 text-sm text-red-400');
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Sending...';
    let succeeded = false;

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, intent }),
      });

      if (res.ok) {
        setMessage(
          messageElement,
          successMessage ||
            (intent === 'hosted' ? "You're on the list! We'll be in touch." : 'Subscribed! Check your inbox.'),
          'mt-3 text-sm text-brand-600 dark:text-brand-400',
        );
        form.reset();
        submitButton.textContent = 'Done';
        succeeded = true;
        return;
      }

      // Show server error message when available (e.g., rate limit)
      try {
        const body = (await res.json()) as { error?: string };
        setMessage(
          messageElement,
          body.error || 'Something went wrong. Please try again.',
          'mt-3 text-sm text-red-400',
        );
      } catch {
        setMessage(messageElement, 'Something went wrong. Please try again.', 'mt-3 text-sm text-red-400');
      }
    } catch {
      setMessage(messageElement, 'Something went wrong. Please try again.', 'mt-3 text-sm text-red-400');
    } finally {
      if (!succeeded) {
        submitButton.disabled = false;
        submitButton.textContent = intent === 'hosted' ? 'Join Waitlist' : 'Subscribe';
      }
    }
  });
}

function bindForms() {
  document.querySelectorAll<HTMLFormElement>('[data-subscribe-form]').forEach(setupForm);
}

bindForms();
document.addEventListener('astro:after-swap', bindForms);
