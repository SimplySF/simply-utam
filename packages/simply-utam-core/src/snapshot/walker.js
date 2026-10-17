/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The DOM snapshot walker. Every way of capturing a snapshot sends this file's function to the page
// as text and runs `(<function>)(options)`, so it must stay one function declaration with no imports
// and no references to anything outside it. Core reads this file as text; nothing compiles it.
// It returns the snapshot as a JSON string.
function domSnapshotWalker(input) {
  'use strict';

  const options = input || {};
  const mask = options.mask || 'labels';
  const maxNodes = options.maxNodes ?? 20000;
  const maxHiddenNodes = options.maxHiddenNodes ?? 5000;
  const timeBudgetMs = options.timeBudgetMs ?? 3000;
  const root = document.documentElement;
  // jsdom has no `checkVisibility` and no layout, so tests pass both in.
  const isVisibleNative =
    options.checkVisibility ||
    (typeof Element.prototype.checkVisibility === 'function'
      ? (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      : null);
  const getRect = options.getRect || ((el) => el.getBoundingClientRect());
  // 'none' (document order), 'auto' (the active Lightning page or console tab), or a CSS selector.
  const focus = options.focus || 'none';

  // ---- Rules as data -------------------------------------------------------------------------

  const KEPT_ATTRS = [
    'id',
    'class',
    'name',
    'type',
    'role',
    'slot',
    'aria-hidden',
    'title',
    'aria-label',
    'placeholder',
    'alt',
    'value',
  ];
  const KEEP_BY_ATTR = ['name', 'type', 'role', 'slot', 'title', 'aria-label', 'placeholder', 'alt'];
  const KEEP_TAGS = ['a', 'button', 'input', 'select', 'textarea', 'label', 'option', 'iframe'];
  const DROP_TAGS = ['head', 'script', 'style', 'link', 'meta', 'template', 'noscript'];
  const HIDDEN_KEEP_ATTRS = ['name'];
  const LABEL_SELECTORS = [
    'label',
    'legend',
    'button',
    'option',
    'th[scope="col"]',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    '[role="button"]',
    '[role="columnheader"]',
    '[role="tab"]',
    '.slds-form-element__label',
    '.test-id__field-label',
    '.slds-card__header-title',
    '.slds-text-title',
    'records-entity-label',
  ];
  // Never label-like, even under a label-like ancestor: Lightning shows record values in these.
  const NEVER_LABEL_SELECTORS = [
    'a:not([role="tab"]):not([role="button"])',
    'h1',
    '[role="option"]',
    '[role="menuitem"]',
    'th:not([scope="col"])',
  ];
  const NEVER_LABEL_TAG_PREFIXES = ['lightning-formatted-'];
  const ALWAYS_MASK_WITHIN = ['.tabBarItems', 'tbody', '[role="row"]:not(thead *)'];
  const CONTROL_TAGS = ['button', 'input', 'select', 'textarea'];
  const CONTROL_ROLES = ['button', 'tab', 'checkbox', 'combobox'];
  const CONTROL_ONLY_ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
  const VALUE_ATTRS = ['value', 'data-value', 'data-text', 'data-label-value'];
  const FOCUS_SELECTORS = ['section.tabContent.oneConsoleTab', '.oneContent.lafPageHost', '[role="main"]', 'main'];

  // ---- State ---------------------------------------------------------------------------------

  const start = performance.now();
  const reasons = [];
  let visibleCount = 0;
  let hiddenCount = 0;
  let visibleFull = false;
  let hiddenFull = false;
  let outOfTime = false;
  const hiddenQueue = [];

  function addReason(reason) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }

  function checkTime() {
    if (!outOfTime && performance.now() - start > timeBudgetMs) {
      outOfTime = true;
      addReason('time');
    }
    return outOfTime;
  }

  // ---- Masking -------------------------------------------------------------------------------

  function maskValue(value) {
    return '•' + value.length;
  }

  function scrub(value) {
    return value
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '•email')
      .replace(/\b(?=[a-zA-Z0-9]*\d)[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/g, '•id');
  }

  function matchesAny(el, selectors) {
    for (const selector of selectors) {
      try {
        if (el.matches(selector)) return true;
      } catch {
        // An unsupported selector in the list must not stop the walk.
      }
    }
    return false;
  }

  function isNeverLabel(el) {
    const tag = el.localName;
    for (const prefix of NEVER_LABEL_TAG_PREFIXES) if (tag.startsWith(prefix)) return true;
    return matchesAny(el, NEVER_LABEL_SELECTORS);
  }

  // The element or an ancestor within two levels, in the same tree, matches the label list, and
  // none of those levels is a never-label element.
  function isLabelLike(el) {
    let current = el;
    let labelLike = false;
    for (let level = 0; level < 3 && current; level++) {
      if (isNeverLabel(current)) return false;
      if (!labelLike && matchesAny(current, LABEL_SELECTORS)) labelLike = true;
      current = current.parentElement;
    }
    return labelLike;
  }

  function isControl(el) {
    if (CONTROL_TAGS.includes(el.localName)) return true;
    const role = el.getAttribute('role');
    return role !== null && CONTROL_ROLES.includes(role);
  }

  function isValueAttr(name) {
    return VALUE_ATTRS.includes(name) || (name.startsWith('data-') && name.endsWith('-value'));
  }

  function maskText(text, el, inMaskZone) {
    if (mask === 'full') return text;
    if (mask === 'structure' || inMaskZone) return maskValue(text);
    return isLabelLike(el) ? scrub(text) : maskValue(text);
  }

  function maskAttr(name, value, el, inMaskZone) {
    if (mask === 'full') return value;
    if (isValueAttr(name)) return maskValue(value);
    if (CONTROL_ONLY_ATTRS.includes(name)) {
      if (mask === 'structure' || inMaskZone || !isControl(el)) return maskValue(value);
    }
    return scrub(value);
  }

  // ---- Element facts -------------------------------------------------------------------------

  function isGeneratedId(id) {
    return /-\d+$/.test(id) || /^\d+:\d+/.test(id) || /;a$/.test(id);
  }

  // Text nodes directly under `parent`: an element's light children, or a shadow root's.
  function ownText(parent) {
    let text = '';
    for (const child of parent.childNodes) {
      if (child.nodeType === 3) text += ' ' + child.nodeValue;
    }
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > 80 ? text.slice(0, 80) : text;
  }

  function shadowMode(shadowRoot) {
    if (shadowRoot.synthetic === true) return 'synthetic';
    if (Object.prototype.toString.call(shadowRoot) === '[object ShadowRoot]' && shadowRoot.synthetic === undefined) {
      return 'native';
    }
    return 'unknown';
  }

  // Hidden, judged only where the parent is visible.
  function isHidden(el, tag) {
    // An option has no box of its own in a closed select; it's as visible as the select.
    if (tag === 'option' || tag === 'optgroup') return false;
    // `checkVisibility` is false for `display: contents`, whose children still render.
    const style = getComputedStyle(el);
    if (style.display === 'contents') return false;
    const hidden = isVisibleNative
      ? !isVisibleNative(el)
      : style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    // `visibility` is inherited but can be overridden: a descendant set back to `visible` still
    // renders. Such an element isn't the top of a hidden subtree; its children are judged on their own.
    if (hidden && hiddenByVisibilityOnly(style) && hasVisibleDescendant(el)) return false;
    return hidden;
  }

  function hiddenByVisibilityOnly(style) {
    return style.visibility !== 'visible' && style.display !== 'none' && style.opacity !== '0';
  }

  // A light or shadow descendant whose own `visibility` is `visible`, under no `display: none` or
  // `opacity: 0`.
  function hasVisibleDescendant(el) {
    const children = (node) => [...node.children, ...(node.shadowRoot ? node.shadowRoot.children : [])];
    const stack = children(el);
    while (stack.length > 0) {
      const child = stack.pop();
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.opacity === '0') continue;
      if (style.visibility === 'visible') return true;
      stack.push(...children(child));
    }
    return false;
  }

  function shouldKeep(el, tag, inHidden) {
    // The walk's root and `body` are always kept, so the snapshot has one root node.
    if (el === root || tag === 'body') return true;
    if (el.shadowRoot) return true;
    if (tag.includes('-')) return true;
    const hasData = el.getAttributeNames().some((name) => name.startsWith('data-'));
    if (inHidden) {
      return hasData || HIDDEN_KEEP_ATTRS.some((name) => el.hasAttribute(name)) || ownText(el) !== '';
    }
    if (KEEP_TAGS.includes(tag) || tag === 'svg') return true;
    if (hasData) return true;
    if (KEEP_BY_ATTR.some((name) => el.hasAttribute(name))) return true;
    const id = el.getAttribute('id');
    if (id && !isGeneratedId(id)) return true;
    return ownText(el) !== '';
  }

  function makeNode(el, tag, address, inHidden, inMaskZone) {
    const node = { address, tag };
    const attrs = {};
    let hasAttrs = false;
    for (const name of el.getAttributeNames()) {
      if (!KEPT_ATTRS.includes(name) && !name.startsWith('data-')) continue;
      const value = el.getAttribute(name);
      if (name === 'id' && isGeneratedId(value)) continue;
      attrs[name] = maskAttr(name, value, el, inMaskZone);
      hasAttrs = true;
    }
    if (hasAttrs) node.attrs = attrs;
    const text = ownText(el);
    if (text !== '') node.text = maskText(text, el, inMaskZone);
    if (!inHidden) {
      const rect = getRect(el);
      node.rect = [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
    }
    if (tag === 'iframe') {
      const src = el.getAttribute('src');
      if (src) node.src = mask === 'full' ? src : scrub(src.split('?')[0].split('#')[0]);
      node.notCaptured = true;
    }
    return node;
  }

  // ---- Focus ---------------------------------------------------------------------------------

  // Set when a focus element is walked first: the element, the elements from it up to the root
  // (crossing shadow hosts), and the nodes its walk produced, spliced in when the main walk gets there.
  let focusEl = null;
  let focusPath = null;
  let focusOut = null;
  let focusAddress = null;

  function findFocus() {
    if (focus === 'none') return null;
    const selectors = focus === 'auto' ? FOCUS_SELECTORS : [focus];
    for (const selector of selectors) {
      let matches;
      try {
        matches = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of matches) {
        if (el !== root && (!isVisibleNative || isVisibleNative(el))) return el;
      }
    }
    return null;
  }

  // The address `el` gets in the main walk, whether a mask zone covers it, and its ancestor chain.
  function locate(el) {
    const segments = [];
    const path = new Set([el]);
    let zone = false;
    let current = el;
    while (current !== root) {
      const parent = current.parentElement;
      if (parent) {
        segments.unshift(String(Array.prototype.indexOf.call(parent.children, current)));
        current = parent;
      } else {
        const shadowRoot = current.parentNode;
        if (!shadowRoot || !shadowRoot.host) return null;
        segments.unshift('s.' + Array.prototype.indexOf.call(shadowRoot.children, current));
        current = shadowRoot.host;
      }
      path.add(current);
      if (current !== root && matchesAny(current, ALWAYS_MASK_WITHIN)) zone = true;
    }
    return { address: ['0', ...segments].join('.'), path, zone };
  }

  // ---- Walk ----------------------------------------------------------------------------------

  // Visit `el`, adding its node (or, when pruned, its kept descendants) to `out`.
  function visit(el, address, out, inHidden, inMaskZone) {
    if (el === focusEl && focusOut) {
      for (const node of focusOut) out.push(node);
      return;
    }
    // The focus element's ancestors are always walked, so its nodes have somewhere to go; so are the
    // root and `body`, so the snapshot always has its root. Their descendants can still be cut.
    const always = el === root || el === document.body;
    const onFocusPath = always || (focusOut !== null && focusPath.has(el));
    if (checkTime() && !onFocusPath) return;
    if (inHidden ? hiddenFull : visibleFull && !onFocusPath) return;
    const tag = el.localName;
    if (DROP_TAGS.includes(tag)) return;
    const zone = inMaskZone || matchesAny(el, ALWAYS_MASK_WITHIN);

    // The top of a hidden subtree: kept while the hidden budget lasts, and walked after the visible tree.
    if (!inHidden && isHidden(el, tag)) {
      if (hiddenCount >= maxHiddenNodes && !always) {
        hiddenFull = true;
        addReason('hiddenNodes');
        return;
      }
      const node = makeNode(el, tag, address, true, zone);
      node.hidden = true;
      out.push(node);
      hiddenCount++;
      hiddenQueue.push({ el, address, node, zone });
      return;
    }

    let node = null;
    if (shouldKeep(el, tag, inHidden)) {
      if (inHidden) {
        if (hiddenCount >= maxHiddenNodes) {
          hiddenFull = true;
          addReason('hiddenNodes');
          return;
        }
        hiddenCount++;
      } else {
        if (visibleCount >= maxNodes && !onFocusPath) {
          visibleFull = true;
          addReason('nodes');
          return;
        }
        visibleCount++;
      }
      node = makeNode(el, tag, address, inHidden, zone);
      out.push(node);
    }

    if (tag === 'svg') return;
    walkTrees(el, address, node, node ? null : out, inHidden, zone);
  }

  // Walk an element's light children and its shadow root. A kept element gets its own `children`
  // and `shadow`; a pruned one passes its light children up to `out`.
  function walkTrees(el, address, node, out, inHidden, zone) {
    const lightChildren = node ? [] : out;
    let index = 0;
    for (const child of el.children) {
      visit(child, address + '.' + index, lightChildren, inHidden, zone);
      index++;
    }
    if (node && lightChildren.length > 0) node.children = lightChildren;

    const shadowRoot = el.shadowRoot;
    // shouldKeep keeps every element with a shadow root, so `node` is set here.
    if (shadowRoot && node) {
      const shadowChildren = [];
      let shadowIndex = 0;
      for (const child of shadowRoot.children) {
        visit(child, address + '.s.' + shadowIndex, shadowChildren, inHidden, zone);
        shadowIndex++;
      }
      node.shadow = { mode: shadowMode(shadowRoot), children: shadowChildren };
      // Components like `lightning-formatted-text` render their text straight into the shadow
      // root, with no element around it. It's masked by the rules for the host.
      const shadowText = ownText(shadowRoot);
      if (shadowText !== '') node.shadow.text = maskText(shadowText, el, zone);
    } else if (node && looksClosed(el, node)) {
      // A closed shadow root isn't visible through `shadowRoot`, to the walker or to UTAM.
      node.shadow = { mode: 'unreadable', children: [] };
    }
  }

  // A defined custom element that takes up space but has no readable shadow root, no children and
  // no text of its own: most likely it renders into a closed shadow root.
  function looksClosed(el, node) {
    if (!node.tag.includes('-') || el.children.length > 0 || node.text !== undefined) return false;
    if (!node.rect || node.rect[2] === 0 || node.rect[3] === 0) return false;
    return typeof customElements !== 'undefined' && customElements.get(node.tag) !== undefined;
  }

  const found = findFocus();
  if (found) {
    const located = locate(found);
    if (located) {
      focusEl = found;
      focusPath = located.path;
      focusAddress = located.address;
      const out = [];
      visit(focusEl, located.address, out, false, located.zone || matchesAny(focusEl, ALWAYS_MASK_WITHIN));
      focusOut = out;
    }
  }

  const rootChildren = [];
  visit(root, '0', rootChildren, false, false);

  for (let i = 0; i < hiddenQueue.length; i++) {
    if (checkTime() || hiddenFull) break;
    const { el, address, node, zone } = hiddenQueue[i];
    walkTrees(el, address, node, null, true, zone);
  }

  // ---- Metadata ------------------------------------------------------------------------------

  function maskUrl(href) {
    if (mask === 'full') return href;
    return scrub(href.split('?')[0].split('#')[0]);
  }

  function maskTitle(title) {
    if (mask === 'full') return title;
    const parts = title.split('|').map((part) => part.trim());
    return parts.map((part, i) => (i === parts.length - 1 ? part : maskValue(part))).join(' | ');
  }

  const meta = {
    capturedAt: new Date().toISOString(),
    trigger: options.trigger || 'manual',
    url: maskUrl(location.href),
    title: maskTitle(document.title),
    viewport: [window.innerWidth, window.innerHeight],
  };
  if (options.label) meta.label = options.label;
  meta.mask = mask;
  meta.truncated = reasons.length > 0 ? { reasons } : null;
  if (focusAddress) meta.focus = focusAddress;

  return JSON.stringify({
    format: 'simply-utam-dom-snapshot',
    version: 1,
    meta,
    root: rootChildren[0] || null,
  });
}
