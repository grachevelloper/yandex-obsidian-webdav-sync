export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = app.document.createElement('section');
    this.contentEl = app.document.createElement('div');
    this.contentEl.createEl = (tag, options) => {
      const element = app.document.createElement(tag);
      element.className = options.cls ?? '';
      element.textContent = options.text ?? '';
      this.contentEl.append(element);
      return element;
    };
    this.modalEl.append(this.contentEl);
    this.openCount = 0;
  }
  setTitle(title) {
    this.title = title;
  }
  open() {
    this.openCount++;
    this.isOpen = true;
    this.onOpen();
  }
  close() {
    this.isOpen = false;
    this.onClose();
  }
}

export class ButtonComponent {
  constructor(container) {
    this.buttonEl = container.ownerDocument.createElement('button');
    container.append(this.buttonEl);
  }
  setButtonText(text) {
    this.buttonEl.textContent = text;
    return this;
  }
  setDisabled(disabled) {
    this.buttonEl.disabled = disabled;
    return this;
  }
  setCta() {
    return this;
  }
  onClick(callback) {
    this.buttonEl.addEventListener('click', callback);
    return this;
  }
}

export class ProgressBarComponent {
  constructor(container) {
    this.container = container;
  }
  setValue(value) {
    this.container.dataset.value = String(value);
    return this;
  }
}
