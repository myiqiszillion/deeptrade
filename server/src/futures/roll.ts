export interface RollEvent { root: string; fromContract: string; toContract: string; rollDate: string; gap: number; }
export function detectRoll(prevClose: number, nextOpen: number): number { return nextOpen - prevClose; }
