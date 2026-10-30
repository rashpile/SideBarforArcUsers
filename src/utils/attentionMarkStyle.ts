// "Mark for Attention colour" setting: the colour and strength of the ring on
// tab and bookmark rows marked for attention. App.tsx puts the value on the
// theme root as data-attention-style; index.css turns it into the ring's look.

export type AttentionMarkColour = 'green' | 'blue' | 'orange' | 'red' | 'purple' | 'yellow' | 'accent';

// Normal strength has no suffix, so the default 'green' reads as the look before the setting existed
export type AttentionMarkStyle = AttentionMarkColour | `${AttentionMarkColour}-dim` | `${AttentionMarkColour}-bright`;

// chrome.storage.local key, raw string (the Settings dialog stores it with
// serialize: v => v). Written by the Settings dialog, read by App.tsx.
export const ATTENTION_MARK_STYLE_KEY = 'attentionMarkStyle';

export const DEFAULT_ATTENTION_MARK_STYLE: AttentionMarkStyle = 'green';

const COLOURS: readonly { colour: AttentionMarkColour; label: string }[] = [
  { colour: 'green', label: 'Green' },
  { colour: 'blue', label: 'Blue' },
  { colour: 'orange', label: 'Orange' },
  { colour: 'red', label: 'Red' },
  { colour: 'purple', label: 'Purple' },
  { colour: 'yellow', label: 'Yellow' },
  { colour: 'accent', label: 'Space colour' },
];

const STRENGTHS: readonly { suffix: string; label: string }[] = [
  { suffix: '-dim', label: ' - dim' },
  { suffix: '', label: '' },
  { suffix: '-bright', label: ' - bright' },
];

export interface AttentionMarkStyleOption
{
  value: AttentionMarkStyle;
  label: string;
}

/** Every preset for the Settings select, grouped by colour: dim, normal, bright. */
export const ATTENTION_MARK_STYLE_OPTIONS: readonly AttentionMarkStyleOption[] = COLOURS.flatMap(({ colour, label }) =>
  STRENGTHS.map(strength => ({
    value: `${colour}${strength.suffix}` as AttentionMarkStyle,
    label: `${label}${strength.label}`,
  }))
);

/** Parse a stored value, falling back to the default for absent/unknown values. */
export function parseAttentionMarkStyle(value: unknown): AttentionMarkStyle
{
  return ATTENTION_MARK_STYLE_OPTIONS.find(option => option.value === value)?.value ?? DEFAULT_ATTENTION_MARK_STYLE;
}
