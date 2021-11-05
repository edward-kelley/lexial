/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {OutlineEditor} from 'outline';

import useLayoutEffect from './shared/useLayoutEffect';
import {useState} from 'react';
import {isBlankFromEditorState} from 'outline/root';

/**
 * DEPRECATED. Use useOutlineIsBlank
 */
export default function useCometOutlineIsEmpty(editor: OutlineEditor): boolean {
  const [isCurrentlyEmpty, setIsEmpty] = useState(true);

  useLayoutEffect(() => {
    return editor.addListener('update', ({editorState}) => {
      const isComposing = editor.isComposing();
      setIsEmpty(isBlankFromEditorState(editorState, isComposing));
    });
  }, [editor]);
  return isCurrentlyEmpty;
}
