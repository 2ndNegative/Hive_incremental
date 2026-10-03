// Squarified treemap.
//
// Lays values out as rectangles whose AREAS are exactly proportional to the
// values, packed so each one comes out as close to square as it can. That last
// part is the whole point: the naive algorithm (slice the rectangle, recurse)
// is exact too, but it turns a 2% holding into a one-pixel ribbon nobody can
// read or click. Squarified keeps the small ones usable.
//
// Bruls, Huizing & van Wijk, "Squarified Treemaps" (2000).
//
// Pure: it takes values and a frame and returns rectangles. Nothing here knows
// what a biome is, which is why it can be tested on its own.

/**
 * @param {Array<{ id: string, value: number }>} items  values must be >= 0
 * @param {number} width
 * @param {number} height
 * @returns {Array<{ id, value, x, y, w, h }>} in the order they were laid out
 */
export function squarify(items, width, height) {
  const live = items.filter((i) => i.value > 0);
  if (!live.length || width <= 0 || height <= 0) return [];

  // Largest first. The algorithm only produces square-ish tiles if it places
  // the big ones while it still has a big rectangle to place them in.
  const queue = [...live].sort((a, b) => b.value - a.value);
  const total = queue.reduce((sum, i) => sum + i.value, 0);
  const scale = (width * height) / total;

  const out = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;

  // How far from square the worst tile in this row would be. Lower is better;
  // 1 is a perfect square.
  const worstRatio = (row, thickness) => {
    let worst = 1;
    for (const item of row) {
      const length = (item.value * scale) / thickness;
      if (length <= 0) return Infinity;
      worst = Math.max(worst, thickness / length, length / thickness);
    }
    return worst;
  };

  while (queue.length && w > 1e-9 && h > 1e-9) {
    // Always lay the row along the shorter side, so the row is wide and flat
    // rather than long and thin.
    const vertical = w >= h;
    const side = vertical ? h : w;

    const row = [];
    let best = Infinity;
    while (queue.length) {
      const candidate = [...row, queue[0]];
      const sum = candidate.reduce((a, i) => a + i.value, 0) * scale;
      const thickness = sum / side;
      const ratio = worstRatio(candidate, thickness);
      // Adding this one made the row MORE square, so keep it and try another.
      if (ratio <= best) {
        row.push(queue.shift());
        best = ratio;
      } else {
        break;
      }
    }

    const sum = row.reduce((a, i) => a + i.value, 0) * scale;
    const thickness = sum / side;
    let offset = 0;
    for (const item of row) {
      const length = (item.value * scale) / thickness;
      out.push(
        vertical
          ? { ...item, x, y: y + offset, w: thickness, h: length }
          : { ...item, x: x + offset, y, w: length, h: thickness },
      );
      offset += length;
    }

    if (vertical) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
  }

  // A holding vastly smaller than the rest can exhaust the frame before it is
  // reached — 10,000 m² of ocean beside 1 m² of vent leaves literally no room
  // for the vent. Dropping it would be worse than drawing it too small, because
  // a tile that is not in the document cannot be hovered, counted or explained.
  // So the remainder is laid into whatever is left, however little that is, and
  // the stylesheet gives every tile a minimum visible size.
  if (queue.length) {
    const rest = queue.reduce((a, i) => a + i.value, 0);
    let offset = 0;
    for (const item of queue) {
      const fraction = rest > 0 ? item.value / rest : 1 / queue.length;
      const length = (w >= h ? h : w) * fraction;
      out.push(
        w >= h
          ? { ...item, x, y: y + offset, w, h: length }
          : { ...item, x: x + offset, y, w: length, h },
      );
      offset += length;
    }
  }

  // Floating point can leave the last row a hair short of the frame edge.
  // Snapping it closes the seam without moving anything measurably.
  for (const tile of out) {
    if (tile.x + tile.w > width - 0.5) tile.w = width - tile.x;
    if (tile.y + tile.h > height - 0.5) tile.h = height - tile.y;
  }

  return out;
}
