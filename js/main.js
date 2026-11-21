import { initCheckout } from './pay.js';

initCheckout();

// subtle parallax on the section watermark marks
const plx = [...document.querySelectorAll('[data-plx]')];
if (plx.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let tick = false;
  const update = () => {
    tick = false;
    const mid = innerHeight / 2;
    for (const el of plx) {
      const r = el.parentElement.getBoundingClientRect();
      const off = (r.top + r.height / 2 - mid) * parseFloat(el.dataset.plx);
      el.style.translate = `0 ${off.toFixed(1)}px`;
    }
  };
  addEventListener('scroll', () => {
    if (!tick) { tick = true; requestAnimationFrame(update); }
  }, { passive: true });
  addEventListener('resize', update);
  update();
}
