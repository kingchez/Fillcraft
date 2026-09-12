// A vibrant, cycling palette used to color-code categories throughout the UI
// (sidebar dots, card accent bars, chips). Index wraps around via modulo so
// any number of categories gets a color, no matter how many exist.
export const PALETTE = [
  '#FF6B6B', // coral red
  '#FFD166', // warm yellow
  '#06D6A0', // mint green
  '#4CC9F0', // sky blue
  '#A78BFA', // violet
  '#F472B6', // pink
  '#FB923C', // orange
  '#5EEAD4', // teal
];

export function colorForIndex(index) {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

export function colorForCategoryId(categories, categoryId) {
  if (!categoryId) return '#6B7280'; // neutral gray for "no category"
  const idx = categories.findIndex((c) => c.id === categoryId);
  return idx === -1 ? '#6B7280' : colorForIndex(idx);
}
