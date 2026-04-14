function observeRevealElements() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
  );

  document.querySelectorAll('.reveal:not(.revealed)').forEach((el) => {
    observer.observe(el);
  });
}

function initTypingAnimations() {
  document.querySelectorAll<HTMLElement>('[data-typed-command]').forEach((el) => {
    if (el.dataset.typed === 'true') return;
    el.dataset.typed = 'true';

    const command = el.dataset.typedCommand || '';
    el.textContent = '';
    let i = 0;

    function type() {
      if (i < command.length) {
        el.textContent += command[i];
        i++;
        setTimeout(type, 60 + Math.random() * 40);
      }
    }

    setTimeout(type, 1200);
  });
}

observeRevealElements();
initTypingAnimations();
document.addEventListener('astro:after-swap', observeRevealElements);
document.addEventListener('astro:after-swap', initTypingAnimations);
