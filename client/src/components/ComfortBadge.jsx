/**
 * Prototype-shaped comfort badge: a solid colored circle with the integer
 * score (1–10) inside. Colors come from `.comfort-badge.s{1..10}` classes in
 * app.css (green → red gradient, matching the prototype).
 */
export function ComfortBadge({ score, size = 36 }) {
  const rounded = Math.max(1, Math.min(10, Math.round(Number(score) || 0)))
  const style = size !== 36
    ? { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.44)}px` }
    : undefined
  return (
    <span
      className={`comfort-badge s${rounded}`}
      style={style}
      title={`Comfort index ${rounded}/10`}
    >
      {rounded}
    </span>
  )
}
