/** Pure named cell: explicit exports survive; no live resource is retained here.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry
 * @param {number} segments @returns {Array<readonly [number, number]>}
 */
export function ellipse(cx, cy, rx, ry, segments = 80) {
  if (!Number.isInteger(segments) || segments < 4) throw new RangeError('segments');
  return Array.from({length: segments + 1}, (_, i) => {
    const a = (i === segments ? 0 : i) * 2 * Math.PI / segments;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}
