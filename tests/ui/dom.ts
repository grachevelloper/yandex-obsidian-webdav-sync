import { JSDOM } from 'jsdom';

export function createDom(...options: ConstructorParameters<typeof JSDOM>) {
  const dom = new JSDOM(...options);
  dom.window.createFragment = () => dom.window.document.createDocumentFragment();
  globalThis.createFragment = () => dom.window.createFragment();
  Object.defineProperties(dom.window.Node.prototype, {
    createEl: {
      value(this: Node, tag: string, options: DomElementInfo = {}) {
        const document = this.ownerDocument;
        if (!document) throw new Error('Expected an owner document');
        const element = document.createElement(tag);
        element.className = Array.isArray(options.cls)
          ? options.cls.join(' ')
          : (options.cls ?? '');
        if (options.text !== undefined) element.append(options.text);
        this.appendChild(element);
        return element;
      },
    },
    createSpan: {
      value(this: Node, options: DomElementInfo = {}) {
        return this.createEl('span', options);
      },
    },
    empty: {
      value(this: HTMLElement) {
        this.replaceChildren();
      },
    },
    win: {
      get(this: Node) {
        return this.ownerDocument?.defaultView;
      },
    },
  });
  return dom;
}
