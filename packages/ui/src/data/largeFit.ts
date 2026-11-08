/** What a box or poster has to fill, in rem, so its text can be sized to fit. */
export interface CellSize {
  width: number;
  height: number;
}

const longestWord = (text: string): number => text.split(/\s+/).reduce((most, word) => Math.max(most, Array.from(word).length), 1);

/** Width of a character as a share of the font size, for bold text in Latin and Arabic. */
const CHAR_WIDTH = 0.64;
/** Padding and border either side of the text in a box. */
const BOX_PADDING = 3.4;
const MIN_SIZE = 1.1;

/**
 * A text size that fits: no bigger than `base`, no bigger than a share of the cell's height, and
 * small enough that the longest word fits the width. The width can't be left to wrapping, which
 * breaks a long word in the middle at big text sizes.
 */
export function fitText(text: string, base: number, size: CellSize, heightShare: number): string {
  const byHeight = size.height * heightShare;
  const byWidth = (size.width - BOX_PADDING) / (longestWord(text) * CHAR_WIDTH);
  return `${Math.max(MIN_SIZE, Math.min(base, byHeight, byWidth)).toFixed(2)}rem`;
}
