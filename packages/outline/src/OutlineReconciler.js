import {IS_IMMUTABLE, IS_SEGMENTED} from './OutlineNode';

let subTreeTextContent = '';
let forceTextDirection = null;

const RTL = '\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC';
const LTR =
  'A-Za-z\u00C0-\u00D6\u00D8-\u00F6' +
  '\u00F8-\u02B8\u0300-\u0590\u0800-\u1FFF\u200E\u2C00-\uFB1C' +
  '\uFE00-\uFE6F\uFEFD-\uFFFF';

const rtl = new RegExp('^[^' + LTR + ']*[' + RTL + ']');
const ltr = new RegExp('^[^' + RTL + ']*[' + LTR + ']');

function getTextDirection(text) {
  if (rtl.test(text)) {
    return 'rtl';
  }
  if (ltr.test(text)) {
    return 'ltr';
  }
  return '';
}

function handleBlockTextDirection(dom) {
  if (forceTextDirection === null) {
    const prevSubTreeTextContent = dom.__outlineTextContent;
    if (prevSubTreeTextContent !== subTreeTextContent) {
      dom.dir = getTextDirection(subTreeTextContent);
      dom.__outlineTextContent = subTreeTextContent;
    }
  }
}

function destroyNode(key, parentDOM, prevNodeMap, nextNodeMap, editor) {
  const node = prevNodeMap[key];

  if (parentDOM !== null) {
    const dom = editor.getElementByKey(key);
    parentDOM.removeChild(dom);
  }
  if (nextNodeMap[key] === undefined) {
    editor._keyToDOMMap.delete(key);
  }
  if (node.isBlock()) {
    const children = node._children;
    destroyChildren(
      children,
      0,
      children.length - 1,
      null,
      prevNodeMap,
      nextNodeMap,
      editor,
    );
  }
}

function destroyChildren(
  children,
  startIndex,
  endIndex,
  dom,
  prevNodeMap,
  nextNodeMap,
  editor,
) {
  for (; startIndex <= endIndex; ++startIndex) {
    destroyNode(children[startIndex], dom, prevNodeMap, nextNodeMap, editor);
  }
}

function createNode(key, parentDOM, insertDOM, nodeMap, editor) {
  const node = nodeMap[key];
  const dom = node._create();
  storeDOMWithKey(key, dom, editor);

  if (node._flags & IS_IMMUTABLE || node._flags & IS_SEGMENTED) {
    dom.contentEditable = false;
  }

  if (node.isText()) {
    subTreeTextContent += node._text;
  } else {
    // Handle block children
    const children = node._children;
    const previousSubTreeTextContent = subTreeTextContent;
    subTreeTextContent = '';
    const childrenLength = children.length;
    createChildren(children, 0, childrenLength - 1, dom, null, nodeMap, editor);
    handleBlockTextDirection(dom);
    subTreeTextContent = previousSubTreeTextContent;
  }
  if (parentDOM !== null) {
    if (insertDOM !== null) {
      parentDOM.insertBefore(dom, insertDOM);
    } else {
      parentDOM.appendChild(dom);
    }
  }
  return dom;
}

function createChildren(
  children,
  startIndex,
  endIndex,
  dom,
  insertDOM,
  nodeMap,
  editor,
) {
  for (; startIndex <= endIndex; ++startIndex) {
    createNode(children[startIndex], dom, insertDOM, nodeMap, editor);
  }
}

function reconcileNode(
  key,
  parentDOM,
  prevNodeMap,
  nextNodeMap,
  editor,
  dirtySubTrees,
) {
  const prevNode = prevNodeMap[key];
  const nextNode = nextNodeMap[key];
  const prevIsText = prevNode.isText();
  const hasDirtySubTree =
    dirtySubTrees !== null ? dirtySubTrees.has(key) : true;
  const dom = editor.getElementByKey(key);

  if (prevNode === nextNode && !hasDirtySubTree) {
    if (!prevIsText) {
      const prevSubTreeTextContent = dom.__outlineTextContent;
      if (prevSubTreeTextContent !== undefined) {
        subTreeTextContent += prevSubTreeTextContent;
      }
    } else {
      subTreeTextContent += prevNode._text;
    }
    return;
  }
  // Update node. If it returns true, we need to unmount and re-create the node
  if (nextNode._update(prevNode, dom)) {
    const replacementDOM = createNode(key, null, null, nextNodeMap, editor);
    parentDOM.replaceChild(replacementDOM, dom);
    destroyNode(key, null, prevNodeMap, nextNodeMap, editor);
    return;
  }
  // Handle text content, for LTR, LTR cases.
  if (nextNode.isText()) {
    subTreeTextContent += nextNode._text;
    return;
  }
  // Reconcile block children
  const prevChildren = prevNode._children;
  const nextChildren = nextNode._children;
  const childrenAreDifferent = prevChildren !== nextChildren;

  if (childrenAreDifferent || hasDirtySubTree) {
    const prevChildrenLength = prevChildren.length;
    const nextChildrenLength = nextChildren.length;
    const previousSubTreeTextContent = subTreeTextContent;
    subTreeTextContent = '';

    if (prevChildrenLength === 1 && nextChildrenLength === 1) {
      const prevChildKey = prevChildren[0];
      const nextChildKey = nextChildren[0];
      if (prevChildKey === nextChildKey) {
        reconcileNode(
          prevChildKey,
          dom,
          prevNodeMap,
          nextNodeMap,
          editor,
          dirtySubTrees,
        );
      } else {
        const lastDOM = editor.getElementByKey(prevChildKey);
        const replacementDOM = createNode(
          nextChildKey,
          null,
          null,
          nextNodeMap,
          editor,
        );
        dom.replaceChild(replacementDOM, lastDOM);
        destroyNode(prevChildKey, null, prevNodeMap, nextNodeMap, editor);
      }
    } else if (prevChildrenLength === 0) {
      if (nextChildrenLength !== 0) {
        createChildren(
          nextChildren,
          0,
          nextChildrenLength - 1,
          dom,
          null,
          nextNodeMap,
          editor,
        );
      }
    } else if (nextChildrenLength === 0) {
      if (prevChildrenLength !== 0) {
        destroyChildren(
          prevChildren,
          0,
          prevChildrenLength - 1,
          null,
          prevNodeMap,
          nextNodeMap,
          editor,
        );
        // Fast path for removing DOM nodes
        dom.textContent = '';
      }
    } else {
      reconcileNodeChildren(
        prevChildren,
        nextChildren,
        prevChildrenLength,
        nextChildrenLength,
        dom,
        prevNodeMap,
        nextNodeMap,
        editor,
        dirtySubTrees,
      );
    }
    handleBlockTextDirection(dom);
    subTreeTextContent = previousSubTreeTextContent;
  }
}

function createKeyToIndexMap(children, startIndex, endIndex) {
  let i, key;
  const map = new Map();
  for (i = startIndex; i <= endIndex; ++i) {
    key = children[i];
    if (key !== undefined) {
      map.set(key, i);
    }
  }
  return map;
}

function findIndexInPrevChildren(
  targetKey,
  prevChildren,
  startIndex,
  endIndex,
) {
  for (let i = startIndex; i < endIndex; i++) {
    const c = prevChildren[i];
    if (c === targetKey) {
      return i;
    }
  }
}

// Disclaimer: this logic was adapted from Vue (MIT):
// https://github.com/vuejs/vue/blob/dev/src/core/vdom/patch.js#L404

function reconcileNodeChildren(
  prevChildren,
  nextChildren,
  prevChildrenLength,
  nextChildrenLength,
  dom,
  prevNodeMap,
  nextNodeMap,
  editor,
  dirtySubTrees,
) {
  let hasClonedPrevChildren = false;
  let prevStartIndex = 0;
  let nextStartIndex = 0;
  let prevEndIndex = prevChildren.length - 1;
  let prevStartKey = prevChildren[0];
  let prevEndKey = prevChildren[prevEndIndex];
  let nextEndIndex = nextChildren.length - 1;
  let nextStartKey = nextChildren[0];
  let nextEndKey = nextChildren[nextEndIndex];
  let prevKeyToIndexMap = null;

  while (prevStartIndex <= prevEndIndex && nextStartIndex <= nextEndIndex) {
    if (prevStartKey === undefined) {
      prevStartKey = prevChildren[++prevStartIndex];
    } else if (nextEndKey === undefined) {
      nextEndKey = prevChildren[--prevEndIndex];
    } else if (prevStartKey === nextStartKey) {
      reconcileNode(
        prevStartKey,
        dom,
        prevNodeMap,
        nextNodeMap,
        editor,
        dirtySubTrees,
      );
      prevStartKey = prevChildren[++prevStartIndex];
      nextStartKey = nextChildren[++nextStartIndex];
    } else if (prevEndKey === nextEndKey) {
      reconcileNode(
        prevEndKey,
        dom,
        prevNodeMap,
        nextNodeMap,
        editor,
        dirtySubTrees,
      );
      prevEndKey = prevChildren[--prevEndIndex];
      nextEndKey = nextChildren[--nextEndIndex];
    } else if (prevStartKey === nextEndKey) {
      reconcileNode(
        prevStartKey,
        dom,
        prevNodeMap,
        nextNodeMap,
        editor,
        dirtySubTrees,
      );
      dom.insertBefore(
        editor.getElementByKey(prevStartKey),
        editor.getElementByKey(prevEndKey).nextSibling,
      );
      prevStartKey = prevChildren[++prevStartIndex];
      nextEndKey = nextChildren[--nextEndIndex];
    } else if (prevEndKey === nextStartKey) {
      reconcileNode(
        prevEndKey,
        dom,
        prevNodeMap,
        nextNodeMap,
        editor,
        dirtySubTrees,
      );
      dom.insertBefore(
        editor.getElementByKey(prevEndKey),
        editor.getElementByKey(prevStartKey),
      );
      prevEndKey = prevChildren[--prevEndIndex];
      nextStartKey = nextChildren[++nextStartIndex];
    } else {
      // Lazily create Map
      if (prevKeyToIndexMap === null) {
        prevKeyToIndexMap = createKeyToIndexMap(
          prevChildren,
          prevStartIndex,
          prevEndIndex,
        );
      }
      const indexInPrevChildren =
        nextStartKey !== undefined
          ? prevKeyToIndexMap.get(nextStartKey)
          : findIndexInPrevChildren(
              nextStartKey,
              prevChildren,
              prevStartIndex,
              prevEndIndex,
            );
      if (indexInPrevChildren === undefined) {
        createNode(
          nextStartKey,
          dom,
          editor.getElementByKey(prevStartKey),
          nextNodeMap,
          editor,
        );
      } else {
        const keyToMove = prevChildren[indexInPrevChildren];
        if (keyToMove === nextStartKey) {
          reconcileNode(
            keyToMove,
            dom,
            prevNodeMap,
            nextNodeMap,
            editor,
            dirtySubTrees,
          );
          if (hasClonedPrevChildren) {
            hasClonedPrevChildren = true;
            prevChildren = [...prevChildren];
          }
          prevChildren[indexInPrevChildren] = undefined;
          dom.insertBefore(
            editor.getElementByKey(keyToMove),
            editor.getElementByKey(prevStartKey),
          );
        } else {
          throw new Error('TODO: Should this ever happen?');
        }
      }
      nextStartKey = nextChildren[++nextStartIndex];
    }
  }
  if (prevStartIndex > prevEndIndex) {
    const previousNode = nextChildren[nextEndIndex + 1];
    const insertDOM =
      previousNode === undefined ? null : editor.getElementByKey(previousNode);
    createChildren(
      nextChildren,
      nextStartIndex,
      nextEndIndex,
      dom,
      insertDOM,
      nextNodeMap,
      editor,
    );
  } else if (nextStartIndex > nextEndIndex) {
    destroyChildren(
      prevChildren,
      prevStartIndex,
      prevEndIndex,
      dom,
      prevNodeMap,
      nextNodeMap,
      editor,
    );
  }
}

export function reconcileViewModel(nextViewModel, editor) {
  const prevViewModel = editor.getCurrentViewModel();
  // TODO: take this value from Editor props, default to null;
  // This will over-ride any sub-tree text direction properties.
  forceTextDirection = null;
  subTreeTextContent = '';
  const dirtySubTrees = nextViewModel._dirtySubTrees;

  reconcileNode(
    'body',
    null,
    prevViewModel.nodeMap,
    nextViewModel.nodeMap,
    editor,
    dirtySubTrees,
  );

  const nextSelection = nextViewModel.selection;
  if (nextSelection !== null) {
    const [startOffset, endOffset] = nextSelection.getRangeOffsets();
    const domSelection = window.getSelection();
    const range = document.createRange();
    const startElement = getSelectionElement(nextSelection.anchorKey, editor);
    const endElement = getSelectionElement(nextSelection.focusKey, editor);
    range.collapse(nextSelection.isCollapsed);
    range.setStart(startElement, startOffset);
    range.setEnd(endElement, endOffset);
    domSelection.removeAllRanges();
    domSelection.addRange(range);
  }
}

function getSelectionElement(key, editor) {
  const element = editor.getElementByKey(key);
  const possibleTextNode = element.firstChild;
  return possibleTextNode.nodeType === 3 ? possibleTextNode : element;
}

export function storeDOMWithKey(key, dom, editor) {
  if (key === null) {
    throw new Error('storeDOMWithNodeKey failed');
  }
  const keyToDOMMap = editor._keyToDOMMap;
  dom.__outlineInternalRef = key;
  keyToDOMMap.set(key, dom);
}

export function getNodeKeyFromDOM(dom, nodeMap) {
  // Adjust target if dom is a text node
  const target = dom.nodeType === 3 ? dom.parentNode : dom;
  const key = target.__outlineInternalRef || null;
  return key;
}
