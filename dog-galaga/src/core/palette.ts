// Fixed 32-color palette. Sprites reference indices by character key.
// Keys: '.' = transparent, then 0-9 a-v map to indices 0..31.
export const PALETTE: string[] = [
  '#0b0a14', // 0 ink (near-black)
  '#1d1b33', // 1 deep night
  '#2f2f5a', // 2 indigo
  '#4b4f8c', // 3 periwinkle
  '#7b84c9', // 4 lavender
  '#b9c1f2', // 5 pale lavender
  '#ffffff', // 6 white
  '#f2e9dc', // 7 cream
  '#e0c7a8', // 8 tan
  '#b88a63', // 9 brown light
  '#8a5a3c', // a brown
  '#5a3826', // b dark brown
  '#ff9ec8', // c pink
  '#e8578f', // d hot pink
  '#a3285f', // e magenta dark
  '#ffd166', // f yellow
  '#f29b38', // g orange
  '#c8612a', // h burnt orange
  '#8fe04a', // i lime
  '#3fa34d', // j green
  '#1f6b45', // k dark green
  '#4ef2e6', // l cyan
  '#26a6c9', // m teal blue
  '#1b5d8f', // n deep blue
  '#9aa3ad', // o gray light
  '#6b7380', // p gray
  '#41464f', // q gray dark
  '#ff5a4f', // r red
  '#b8f2ff', // s ice
  '#c9a2ff', // t violet
  '#7a4fd1', // u purple
  '#2a2438', // v plum shadow
];
export const KEY = '0123456789abcdefghijklmnopqrstuv';
export function idx(ch: string): number { return KEY.indexOf(ch); }
export function col(i: number | string): string {
  return PALETTE[typeof i === 'string' ? idx(i) : i] ?? '#ff00ff';
}
