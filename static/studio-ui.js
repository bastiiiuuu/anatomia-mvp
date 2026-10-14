// Panel preferences survive entering focus mode; overlays never resize the canvas.
// The caller supplies its lifecycle-bound listener helper for complete teardown.
export class StudioUI {
  constructor(on) {
    this.body = document.body;
    this.desktop = matchMedia('(min-width: 1201px)');
    this.wide = matchMedia('(min-width: 901px)');
    this.opener = null;
    this.focusButton = document.getElementById('focus-mode');
    this.buttons = [...document.querySelectorAll('[data-panel]')];
    for (const button of this.buttons) on(button, 'click', () => this.togglePanel(button.dataset.panel, button));
    for (const button of document.querySelectorAll('[data-close-panel]')) on(button, 'click', () => {
      const panel = button.closest('aside').id === 'explorer-panel' ? 'explorer' : 'study';
      if (this.isDocked(panel)) {
        this.body.classList.add(panel + '-collapsed');
        this.opener = this.buttons.find(item => item.dataset.panel === panel && item.offsetParent);
      }
      this.closeOverlays(true);
    });
    on(this.focusButton, 'click', () => this.toggleFocus());
    on(document, 'keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const editing = event.target.closest('input,textarea,select,[contenteditable="true"]');
      if (event.key === 'Escape') {
        if (this.body.matches('.explorer-open,.study-open')) this.closeOverlays(true);
        else if (this.body.classList.contains('focus-mode')) this.toggleFocus();
      } else if (event.key.toLowerCase() === 'f' && !editing && !event.repeat) {
        event.preventDefault(); this.toggleFocus();
      }
    });
    on(this.desktop, 'change', () => this.closeOverlays());
    on(this.wide, 'change', () => this.closeOverlays());
    this.sync();
  }

  isDocked(panel) {
    return !this.body.classList.contains('focus-mode') && (panel === 'explorer' ? this.wide.matches : this.desktop.matches);
  }

  togglePanel(panel, button) {
    if (this.isDocked(panel)) {
      this.body.classList.toggle(panel + '-collapsed');
      this.closeOverlays();
    } else {
      const open = !this.body.classList.contains(panel + '-open');
      this.closeOverlays();
      this.body.classList.toggle(panel + '-open', open);
      this.opener = open ? button : null;
      this.sync();
    }
  }

  closeOverlays(returnFocus = false) {
    this.body.classList.remove('explorer-open', 'study-open');
    if (returnFocus) this.opener?.focus({ preventScroll: true });
    this.opener = null;
    this.sync();
  }

  toggleFocus() {
    this.closeOverlays();
    this.body.classList.toggle('focus-mode');
    this.sync();
  }

  sync() {
    const focus = this.body.classList.contains('focus-mode');
    this.focusButton.setAttribute('aria-pressed', String(focus));
    this.focusButton.title = focus ? 'Salir de concentración (F / Esc)' : 'Modo concentración (F)';
    this.focusButton.setAttribute('aria-label', this.focusButton.title);
    for (const button of this.buttons) {
      const panel = button.dataset.panel;
      const visible = this.isDocked(panel) ? !this.body.classList.contains(panel + '-collapsed') : this.body.classList.contains(panel + '-open');
      button.setAttribute('aria-expanded', String(visible));
    }
  }
}
