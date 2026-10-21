// Copyright (c) 2025 TikTok Pte. Ltd.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.
import type { BaseEvent, StandardProps, TextAreaProps } from '@lynx-js/types';

declare module '@lynx-js/types' {
  interface InputProps {
    value?: string;
    className?: string;
  }

  interface TextAreaProps {
    value?: string;
    className?: string;
  }

  interface GlobalProps {
    preferredTheme?: string;
    theme: string;
    isNotchScreen: boolean;
  }

  interface IntrinsicElements extends Lynx.IntrinsicElements {
    input: InputProps;
    textarea: TextAreaProps & { value?: string; className?: string };
  }
}

export interface InputProps extends StandardProps {
  /**
   * CSS class name for the input element
   */
  className?: string;

  value?: string;

  type?: 'text' | 'password' | 'number' | 'email' | 'url';

  confirmType?: string;

  'confirm-type'?: string;

  'keyboard-type'?: string;

  /**
   * Event handler for input changes
   */
  bindinput?: (e: InputEvent) => void;

  /**
   * Event handler for blur events
   */
  bindblur?: (e: BlurEvent) => void;

  /**
   * Placeholder text when input is empty
   */
  placeholder?: string;

  /**
   * Text color of the input
   */
  'text-color'?: string;
}

export type InputEvent = BaseEvent<'input', { value: string }>;
