import { H as DEFAULT_H, W as DEFAULT_W } from './types';

/**
 * Cells sealed off from the board edge by `barrier` cells (4-connected flood fill from the
 * border). Returns a mask: 1 = enclosed, 0 = outside or barrier.
 */
export function findEnclosed(barrier: Uint8Array, W = DEFAULT_W, H = DEFAULT_H): Uint8Array {
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!seen[i] && !barrier[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = !seen[i] && !barrier[i] ? 1 : 0;
  return out;
}
