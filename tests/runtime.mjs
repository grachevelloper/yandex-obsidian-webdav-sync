import { JSDOM } from 'jsdom';

// Obsidian supplies browser globals; keep the Node runner's native crypto and timers.
globalThis.window = globalThis;

globalThis.DOMParser = new JSDOM().window.DOMParser;
