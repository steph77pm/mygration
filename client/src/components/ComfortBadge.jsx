/**
 * 1-10 comfort index badge with color coding.
 *
 *   >= 8: green (great)
 *   6-7.9: yellow-green (decent)
 *   4-5.9: orange (rough)
 *   < 4: red (avoid)
 */
export function ComfortBadge({ score }) {
  const rounded = Math.round(score * 10) / 10
  let tier = 'bad'
  if (score >= 8) tier = 'great'
  else if (score >= 6) tier = 'ok'
  else if (score >= 4) tier = 'rough'
  return (
    <div className={`comfort-badge comfort-${tier}`} title="Comfort Index (1-10)">
      <span className="comfort-score">{rounded.toFixed(1)}</span>
      <span className="comfort-label">comfort</span>
    </div>
  )
}
