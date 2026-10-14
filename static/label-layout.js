const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

// Keep study labels beside the projected anatomy when space permits. Pure screen
// math, no DOM reads or allocations during camera movement. Output is reusable.
export function placeLabel(bounds, anatomy, pin, width, height, output) {
  const gap = 16, xMax = Math.max(bounds.left, bounds.right - width);
  const yMax = Math.max(bounds.top, bounds.bottom - height);
  let x = clamp(pin.x - width / 2, bounds.left, xMax), y = bounds.top;
  if (bounds.right - anatomy.right >= width + gap) {
    x = anatomy.right + gap; y = pin.y - height / 2;
  } else if (anatomy.left - bounds.left >= width + gap) {
    x = anatomy.left - gap - width; y = pin.y - height / 2;
  } else if (anatomy.top - bounds.top >= height + gap) {
    x = pin.x - width / 2; y = anatomy.top - gap - height;
  } else if (bounds.bottom - anatomy.bottom >= height + gap) {
    x = pin.x - width / 2; y = anatomy.bottom + gap;
  } else {
    // When no side fits, minimize covered anatomy instead of hiding its center.
    let bestArea = Infinity, bestDistance = Infinity;
    for (let side = 0; side < 4; side++) {
      const cx = side < 2 ? (side === 0 ? xMax : bounds.left) : clamp(pin.x - width / 2, bounds.left, xMax);
      const cy = side < 2 ? clamp(pin.y - height / 2, bounds.top, yMax) : (side === 2 ? bounds.top : yMax);
      const area = Math.max(0, Math.min(cx + width, anatomy.right) - Math.max(cx, anatomy.left)) *
        Math.max(0, Math.min(cy + height, anatomy.bottom) - Math.max(cy, anatomy.top));
      const distance = (cx + width / 2 - pin.x) ** 2 + (cy + height / 2 - pin.y) ** 2;
      if (area < bestArea || (area === bestArea && distance < bestDistance)) {
        bestArea = area; bestDistance = distance; x = cx; y = cy;
      }
    }
  }
  output.x = Math.round(clamp(x, bounds.left, xMax));
  output.y = Math.round(clamp(y, bounds.top, yMax));
  return output;
}
