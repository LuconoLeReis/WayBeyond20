// Minimal DOM for WayBeyond20 tests: element tree, text nodes, attributes, visibility, click
// events that bubble to document listeners, and a CSS selector engine covering the forms the
// source uses (tag, .class, #id, [attr], [attr='v' i], [attr*='v'], descendant and child
// combinators, comma lists). It is test scaffolding, not a model of D&D Beyond's real markup.
"use strict";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

class TextNode {
    constructor(text) {
        this.nodeType = TEXT_NODE;
        this._text = String(text);
        this.parentNode = null;
    }
    get textContent() { return this._text; }
    set textContent(value) { this._text = String(value); }
    get parentElement() { return this.parentNode; }
}

function splitTopLevel(selector, separator) {
    const parts = [];
    let depth = 0, quote = null, current = "";
    for (const char of selector) {
        if (quote) {
            if (char === quote) quote = null;
        } else if (char === "'" || char === "\"") {
            quote = char;
        } else if (char === "[") {
            depth++;
        } else if (char === "]") {
            depth--;
        } else if (char === separator && depth === 0) {
            parts.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    parts.push(current);
    return parts.map(part => part.trim()).filter(Boolean);
}

function parseCompound(text) {
    const compound = { tag: null, classes: [], id: null, attrs: [] };
    const pattern = /^([a-zA-Z][\w-]*|\*)|\.([\w-]+)|#([\w-]+)|\[\s*([\w-]+)\s*(?:([*^$]?=)\s*(?:'([^']*)'|"([^"]*)"|([^\]\s]+))\s*(i)?)?\s*\]/g;
    let match;
    let consumed = 0;
    while ((match = pattern.exec(text))) {
        if (match.index !== consumed) throw new Error(`Unsupported selector: ${text}`);
        consumed = pattern.lastIndex;
        if (match[1]) compound.tag = match[1] === "*" ? null : match[1].toUpperCase();
        else if (match[2]) compound.classes.push(match[2]);
        else if (match[3]) compound.id = match[3];
        else compound.attrs.push({
            name: match[4],
            op: match[5] || null,
            value: match[6] ?? match[7] ?? match[8] ?? null,
            insensitive: !!match[9]
        });
    }
    if (consumed !== text.length) throw new Error(`Unsupported selector: ${text}`);
    return compound;
}

function parseComplex(selector) {
    // Tokens: compound, then (combinator, compound)*. Combinators: " " or ">".
    const normalized = selector.replace(/\s*>\s*/g, ">").trim();
    const steps = [];
    let current = "", depth = 0, quote = null, combinator = null;
    const flush = () => {
        if (!current) return;
        steps.push({ combinator, compound: parseCompound(current) });
        current = "";
        combinator = null;
    };
    for (const char of normalized) {
        if (quote) { if (char === quote) quote = null; current += char; continue; }
        if (char === "'" || char === "\"") { quote = char; current += char; continue; }
        if (char === "[") depth++;
        if (char === "]") depth--;
        if (depth === 0 && (char === " " || char === ">")) {
            flush();
            if (char === ">" || combinator !== ">") combinator = char === ">" ? ">" : " ";
            continue;
        }
        current += char;
    }
    flush();
    return steps;
}

function matchesCompound(element, compound) {
    if (!element || element.nodeType !== ELEMENT_NODE) return false;
    if (compound.tag && element.tagName !== compound.tag) return false;
    if (compound.id && element.getAttribute("id") !== compound.id) return false;
    const classes = element.classList._list();
    if (!compound.classes.every(name => classes.includes(name))) return false;
    return compound.attrs.every(attr => {
        const actual = element.getAttribute(attr.name);
        if (attr.op === null) return actual !== null;
        if (actual === null) return false;
        const a = attr.insensitive ? actual.toLowerCase() : actual;
        const v = attr.insensitive ? String(attr.value).toLowerCase() : String(attr.value);
        if (attr.op === "=") return a === v;
        if (attr.op === "*=") return a.includes(v);
        if (attr.op === "^=") return a.startsWith(v);
        if (attr.op === "$=") return a.endsWith(v);
        return false;
    });
}

function matchesComplex(element, steps) {
    let index = steps.length - 1;
    if (!matchesCompound(element, steps[index].compound)) return false;
    let node = element;
    while (index > 0) {
        const combinator = steps[index].combinator;
        index--;
        if (combinator === ">") {
            node = node.parentElement;
            if (!matchesCompound(node, steps[index].compound)) return false;
        } else {
            node = node.parentElement;
            while (node && !matchesCompound(node, steps[index].compound)) node = node.parentElement;
            if (!node) return false;
        }
    }
    return true;
}

const selectorCache = new Map();
function compile(selector) {
    if (!selectorCache.has(selector)) {
        selectorCache.set(selector, splitTopLevel(selector, ",").map(parseComplex));
    }
    return selectorCache.get(selector);
}

class Element {
    constructor(tag, attributes = {}, ownerDocument = null) {
        this.nodeType = ELEMENT_NODE;
        this.tagName = String(tag).toUpperCase();
        this._attributes = new Map();
        this.childNodes = [];
        this.parentNode = null;
        this.style = {};
        this.disabled = false;
        this._listeners = {};
        this.ownerDocument = ownerDocument;
        this.onclick = null;
        const self = this;
        this.classList = {
            _list: () => String(self.getAttribute("class") || "").split(/\s+/).filter(Boolean),
            contains: name => self.classList._list().includes(name),
            add: name => { if (!self.classList.contains(name)) self.setAttribute("class", [...self.classList._list(), name].join(" ")); },
            remove: name => self.setAttribute("class", self.classList._list().filter(item => item !== name).join(" "))
        };
        for (const [name, value] of Object.entries(attributes)) {
            if (name === "disabled") this.disabled = !!value;
            else this.setAttribute(name, value);
        }
    }
    get className() { return this.getAttribute("class") || ""; }
    set className(value) { this.setAttribute("class", value); }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === ELEMENT_NODE ? this.parentNode : null; }
    get children() { return this.childNodes.filter(node => node.nodeType === ELEMENT_NODE); }
    get textContent() { return this.childNodes.map(node => node.textContent).join(""); }
    set textContent(value) { this.childNodes.forEach(node => { node.parentNode = null; }); this.childNodes = [new TextNode(value)]; this.childNodes[0].parentNode = this; }
    get isConnected() {
        let node = this;
        while (node.parentNode) node = node.parentNode;
        return node.isDocumentRoot === true;
    }
    getAttribute(name) { return this._attributes.has(name) ? this._attributes.get(name) : null; }
    setAttribute(name, value) { this._attributes.set(name, String(value)); }
    hasAttribute(name) { return this._attributes.has(name) || (name === "disabled" && this.disabled); }
    removeAttribute(name) { this._attributes.delete(name); }
    get attributes() { return Array.from(this._attributes, ([name, value]) => ({ name, value })); }
    append(...nodes) {
        for (const item of nodes.flat()) {
            if (item === null || item === undefined || item === false) continue;
            const node = typeof item === "string" || typeof item === "number" ? new TextNode(item) : item;
            if (node.parentNode) node.parentNode.childNodes = node.parentNode.childNodes.filter(child => child !== node);
            node.parentNode = this;
            this.childNodes.push(node);
        }
        return this;
    }
    replaceChildren(...nodes) {
        this.childNodes.forEach(node => { node.parentNode = null; });
        this.childNodes = [];
        return this.append(...nodes);
    }
    remove() {
        if (!this.parentNode) return;
        this.parentNode.childNodes = this.parentNode.childNodes.filter(child => child !== this);
        this.parentNode = null;
    }
    matches(selector) { return compile(selector).some(steps => matchesComplex(this, steps)); }
    closest(selector) {
        let node = this;
        while (node && node.nodeType === ELEMENT_NODE) {
            if (node.matches(selector)) return node;
            node = node.parentElement;
        }
        return null;
    }
    _descendants() {
        const out = [];
        const walk = node => node.children.forEach(child => { out.push(child); walk(child); });
        walk(this);
        return out;
    }
    querySelectorAll(selector) {
        const compiled = compile(selector);
        return this._descendants().filter(element => compiled.some(steps => matchesComplex(element, steps)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getClientRects() {
        if (!this.isConnected) return [];
        for (let node = this; node && node.nodeType === ELEMENT_NODE; node = node.parentElement) {
            if (node.style.display === "none" || node.style.visibility === "hidden") return [];
        }
        return [{ width: 1, height: 1 }];
    }
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter(item => item !== fn); }
    dispatchEvent(event) {
        event.target = event.target || this;
        for (let node = this; node; node = node.parentNode) {
            (node._listeners && node._listeners[event.type] || []).forEach(fn => fn(event));
        }
        return true;
    }
    click() {
        if (this.disabled) return;
        const event = { type: "click", target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        if (typeof this.onclick === "function") this.onclick(event);
        this.dispatchEvent(event);
    }
    focus() {}
    scrollIntoView() {}
}

function createDocument() {
    const root = new Element("#document");
    root.isDocumentRoot = true;
    const body = new Element("body");
    root.append(body);
    const document = {
        root,
        body,
        querySelectorAll: selector => root.querySelectorAll(selector),
        querySelector: selector => root.querySelector(selector),
        getElementById: id => root.querySelectorAll(`#${id}`)[0] || null,
        addEventListener: (type, fn) => root.addEventListener(type, fn),
        removeEventListener: (type, fn) => root.removeEventListener(type, fn),
        createElement: tag => new Element(tag)
    };
    return document;
}

// h("div", { class: "x" }, "text", h("span", {}, "child"))
function h(tag, attributes = {}, ...children) {
    return new Element(tag, attributes).append(...children);
}

// Enough jQuery for the helpers under test: find/first/text/closest/length/attr/each.
function miniJQuery(input) {
    const list = input === null || input === undefined ? []
        : (input && input.__mini ? input.toArray()
            : (Array.isArray(input) ? input.filter(Boolean) : [input]));
    const wrapper = {
        __mini: true,
        length: list.length,
        toArray: () => list.slice(),
        find: selector => miniJQuery(list.flatMap(element => element.querySelectorAll(selector))),
        first: () => miniJQuery(list.slice(0, 1)),
        text: () => list.map(element => element.textContent).join(""),
        closest: selector => miniJQuery(list.map(element => element.closest(selector)).filter(Boolean)),
        attr: name => (list[0] ? list[0].getAttribute(name) : undefined),
        each(fn) { list.forEach((element, index) => fn.call(element, index, element)); return wrapper; },
        css: () => undefined
    };
    list.forEach((element, index) => { wrapper[index] = element; });
    return wrapper;
}

module.exports = { Element, TextNode, createDocument, h, miniJQuery, TEXT_NODE, ELEMENT_NODE };
