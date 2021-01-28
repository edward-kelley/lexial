/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {OutlineNode, NodeKey} from './OutlineNode';
import type {ViewModel} from './OutlineView';

import {getActiveViewModel} from './OutlineView';
import {getNodeKeyFromDOM} from './OutlineReconciler';
import {getNodeByKey} from './OutlineNode';
import {BlockNode, TextNode} from '.';
import {invariant} from './OutlineUtils';
import {OutlineEditor} from './OutlineEditor';

export class Selection {
  anchorKey: string;
  anchorOffset: number;
  focusKey: string;
  focusOffset: number;
  isDirty: boolean;
  needsSync: boolean;

  constructor(
    anchorKey: string,
    anchorOffset: number,
    focusKey: string,
    focusOffset: number,
  ) {
    this.anchorKey = anchorKey;
    this.anchorOffset = anchorOffset;
    this.focusKey = focusKey;
    this.focusOffset = focusOffset;
    this.isDirty = false;
    this.needsSync = false;
  }

  isCaret(): boolean {
    return (
      this.anchorKey === this.focusKey && this.anchorOffset === this.focusOffset
    );
  }
  getAnchorNode(): TextNode {
    const anchorKey = this.anchorKey;
    const anchorNode = getNodeByKey(anchorKey);
    invariant(
      anchorNode instanceof TextNode,
      'getAnchorNode: anchorNode not a text node',
    );
    return anchorNode;
  }
  getFocusNode(): TextNode {
    const focusKey = this.focusKey;
    const focusNode = getNodeByKey(focusKey);
    invariant(
      focusNode instanceof TextNode,
      'getFocusNode: focusNode not a text node',
    );
    return focusNode;
  }
  getNodes(): Array<OutlineNode> {
    const anchorNode = this.getAnchorNode();
    const focusNode = this.getFocusNode();
    if (anchorNode === focusNode) {
      return [anchorNode];
    }
    return anchorNode.getNodesBetween(focusNode);
  }
  setRange(
    anchorKey: NodeKey,
    anchorOffset: number,
    focusKey: NodeKey,
    focusOffset: number,
  ): void {
    this.anchorOffset = anchorOffset;
    this.focusOffset = focusOffset;
    this.anchorKey = anchorKey;
    this.focusKey = focusKey;
    this.isDirty = true;
  }
  getTextContent(): string {
    const nodes = this.getNodes();
    let textContent = '';
    nodes.forEach((node) => {
      if (node instanceof TextNode) {
        textContent += node.getTextContent();
      }
    });
    return textContent;
  }
  applyDOMRange(domRange: {
    collapsed: boolean,
    startContainer: Node,
    endContainer: Node,
    startOffset: number,
    endOffset: number,
  }): void {
    const anchorKey = getNodeKeyFromDOM(domRange.startContainer);
    const focusKey = getNodeKeyFromDOM(domRange.endContainer);
    if (anchorKey === null || focusKey === null) {
      throw new Error('Should never happen');
    }
    const [anchorNode, focusNode] = resolveSelectionNodes(anchorKey, focusKey);
    invariant(
      anchorNode instanceof TextNode && focusNode instanceof TextNode,
      'Should never happen',
    );
    this.anchorKey = anchorNode.key;
    this.focusKey = focusNode.key;
    this.anchorOffset =
      anchorNode.getTextContent() === '' ? 0 : domRange.startOffset;
    this.focusOffset =
      focusNode.getTextContent() === '' ? 0 : domRange.endOffset;
  }
}

function resolveSelectionNodes(
  anchorKey: NodeKey,
  focusKey: NodeKey,
): [TextNode | null, TextNode | null] {
  const viewModel = getActiveViewModel();
  const nodeMap = viewModel.nodeMap;
  let anchorNode = nodeMap[anchorKey];
  let focusNode = nodeMap[focusKey];
  if (anchorNode === undefined || focusNode === undefined) {
    return [null, null];
  }
  if (anchorNode instanceof BlockNode) {
    anchorNode = anchorNode.getFirstTextNode();
  }
  if (focusNode instanceof BlockNode) {
    focusNode = focusNode.getLastTextNode();
  }
  // $FlowFixMe: not sure why this doesn't work
  return [anchorNode, focusNode];
}

// This is used to make a selection when the existing
// selection is null, i.e. forcing selection on the editor
// when it current exists outside the editor.
export function makeSelection(
  anchorKey: NodeKey,
  anchorOffset: number,
  focusKey: NodeKey,
  focusOffset: number,
): Selection {
  const viewModel = getActiveViewModel();
  const selection = new Selection(
    anchorKey,
    anchorOffset,
    focusKey,
    focusOffset,
  );
  selection.isDirty = true;
  viewModel.selection = selection;
  return selection;
}

export function createSelection(
  viewModel: ViewModel,
  editor: OutlineEditor,
): null | Selection {
  // When we create a selection, we try to use the previous
  // selection where possible, unless an actual user selection
  // change has occured. When we do need to create a new selection
  // we validate we can have text nodes for both anchor and focus
  // nodes. If that holds true, we then return that selection
  // as a mutable object that we use for the view model for this
  // update cycle. If a selection gets changed, and requires a
  // update to native DOM selection, it gets marked as "dirty".
  // If the selection changes, but matches with the existing
  // DOM selection, then we only need to sync it. Otherwise,
  // we generally bail out of doing an update to selection during
  // reconcialtion unless there are dirty nodes that need
  // reconciling.

  const event = window.event;
  const currentViewModel = editor.getViewModel();
  const lastSelection = currentViewModel.selection;
  const eventType = event && event.type;
  const isComposing = eventType === 'compositionstart';
  const isSelectionChange = eventType === 'selectionchange';
  const useDOMSelection = isSelectionChange || eventType === 'beforeinput';
  let anchorDOM, focusDOM, anchorOffset, focusOffset;

  if (
    event == null ||
    lastSelection === null ||
    useDOMSelection ||
    (isComposing && editor.isKeyDown())
  ) {
    const domSelection: WindowSelection = window.getSelection();
    anchorDOM = domSelection.anchorNode;
    focusDOM = domSelection.focusNode;
    anchorOffset = domSelection.anchorOffset;
    focusOffset = domSelection.focusOffset;
  } else {
    const selection = new Selection(
      lastSelection.anchorKey,
      lastSelection.anchorOffset,
      lastSelection.focusKey,
      lastSelection.focusOffset,
    );
    if (isComposing) {
      selection.isDirty = true;
    }
    return selection;
  }
  let anchorNode: OutlineNode | null = null;
  let focusNode: OutlineNode | null = null;
  let anchorKey: NodeKey | null = null;
  let focusKey: NodeKey | null = null;

  if (editor === null || anchorDOM === null || focusDOM === null) {
    return null;
  }
  const editorElement = editor.getEditorElement();
  if (
    editorElement === null ||
    !editorElement.contains(anchorDOM) ||
    !editorElement.contains(focusDOM)
  ) {
    return null;
  }
  const root = viewModel.nodeMap.root;
  // If we're given the element nodes, lets try and work out what
  // text nodes we can use instead. Otherwise, return null.
  if (anchorDOM === editorElement) {
    anchorNode = root.getFirstTextNode();
    if (anchorNode === null) {
      return null;
    }
    anchorOffset = 0;
    anchorKey = anchorNode.key;
  }
  if (focusDOM === editorElement) {
    focusNode = root.getFirstTextNode();
    if (focusNode === null) {
      return null;
    }
    focusKey = focusNode.key;
    focusOffset = focusNode.getTextContent().length;
  }
  // We try and find the relevant text nodes from the selection.
  // If we can't do this, we return null.
  anchorKey = anchorKey === null ? getNodeKeyFromDOM(anchorDOM) : anchorKey;
  focusKey = focusKey === null ? getNodeKeyFromDOM(focusDOM) : focusKey;
  if (anchorKey === null || focusKey === null) {
    return null;
  }
  // Let's resolve the nodes, in the case we're selecting block nodes.
  // We always to make sure the anchor and focus nodes are text nodes.
  [anchorNode, focusNode] = resolveSelectionNodes(anchorKey, focusKey);
  if (anchorNode === null || focusNode === null) {
    return null;
  }
  anchorKey = anchorNode.key;
  focusKey = focusNode.key;

  // Because we use a special character for whitespace,
  // we need to adjust offsets to 0 when the text is
  // really empty.
  if (anchorNode === focusNode && anchorNode.text === '') {
    anchorOffset = 0;
    focusOffset = 0;
  }

  const selection = new Selection(
    anchorKey,
    anchorOffset,
    focusKey,
    focusOffset,
  );

  // If the selection changes, we need to update our view model
  // regardless to keep the view in sync.
  if (
    lastSelection !== null &&
    isSelectionChange &&
    !isEqual(selection, lastSelection)
  ) {
    selection.needsSync = true;
  }
  return selection;
}

function isEqual(selctionA: Selection, selectionB: Selection): boolean {
  return (
    selctionA.anchorKey === selectionB.anchorKey &&
    selctionA.focusKey === selectionB.focusKey &&
    selctionA.anchorOffset === selectionB.anchorOffset &&
    selctionA.focusOffset === selectionB.focusOffset
  );
}

export function getSelection(): null | Selection {
  const viewModel = getActiveViewModel();
  return viewModel.selection;
}
