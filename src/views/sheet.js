import { $, $$ } from '../lib/dom.js';

let lastFocus = null;

export function openSheet(selector) {
  const sheet = $(selector);
  if (!sheet) return;
  lastFocus = document.activeElement;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheet.querySelector('[data-close-sheet]')?.focus();
}

export function closeSheet(selector) {
  const sheets = selector ? [$(selector)] : $$('.sheet-backdrop');
  sheets.filter(Boolean).forEach(sheet => {
    if (sheet.hidden) return;
    sheet.classList.remove('open');
    sheet.hidden = true;
    lastFocus?.focus?.();
  });
}

export function initSheets() {
  $$('.sheet-backdrop').forEach(sheet => {
    sheet.addEventListener('click', event => {
      if (event.target === sheet || event.target.closest('[data-close-sheet]')) closeSheet('#' + sheet.id);
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSheet();
  });
}
