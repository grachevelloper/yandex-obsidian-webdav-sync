export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = app.document.createElement('section');
    this.contentEl = app.document.createElement('div');
    this.modalEl.append(this.contentEl);
    this.openCount = 0;
  }
  setTitle(title) {
    this.title = title;
  }
  open() {
    this.openCount++;
    this.isOpen = true;
    this.app.document.body.append(this.modalEl);
    this.onOpen();
    this.modalEl.querySelector('button:not([disabled])')?.focus();
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

export const notices = [];
export const http = {
  send: async () => {
    throw new Error('Unexpected request');
  },
};
export const requestUrl = (request) => http.send(request);
export const getLanguage = () => 'en';
export const hostApi = { version: '1.8.7' };
export const requireApiVersion = (version) =>
  hostApi.version.localeCompare(version, 'en', { numeric: true }) >= 0;
export const addIcon = () => {};
export const setTooltip = () => {};
export class Notice {
  constructor(message) {
    notices.push(message);
  }
}
export class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
  async loadData() {
    return null;
  }
  addCommand(command) {
    return command;
  }
  addSettingTab() {}
  addStatusBarItem() {
    return { setText() {} };
  }
  addRibbonIcon() {
    return {};
  }
  registerDomEvent() {}
}
export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = app.document?.createElement('section');
  }
  hide() {}
}

class InputComponent {
  constructor(container, tag) {
    this.inputEl = container.createEl(tag);
  }
  setValue(value) {
    this.inputEl.value = value;
    return this;
  }
  setDisabled(disabled) {
    this.inputEl.disabled = disabled;
    return this;
  }
  addOption(value, label) {
    const option = this.inputEl.createEl('option', { text: label });
    option.value = value;
    return this;
  }
  onChange(callback) {
    this.inputEl.addEventListener('change', () => callback(this.inputEl.value));
    return this;
  }
}

export class Setting {
  constructor(container) {
    this.settingEl = container.createEl('div');
    this.nameEl = this.settingEl.createEl('div');
    this.descEl = this.settingEl.createEl('div');
    this.controlEl = this.settingEl.createEl('div');
  }
  setName(name) {
    this.nameEl.textContent = name;
    return this;
  }
  setDesc(desc) {
    this.descEl.replaceChildren(desc);
    return this;
  }
  addText(callback) {
    callback(new InputComponent(this.controlEl, 'input'));
    return this;
  }
  addDropdown(callback) {
    callback(new InputComponent(this.controlEl, 'select'));
    return this;
  }
  addButton(callback) {
    callback(new ButtonComponent(this.controlEl));
    return this;
  }
}
