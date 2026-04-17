import { usePersistedState } from '../hooks/usePersistedState.js'
import { ChildLocationRow } from './ChildLocationRow.jsx'

/**
 * A parent area with expandable child locations underneath.
 *
 * When collapsed: shows a summary row (area name, child count, rollup stats).
 * When expanded: shows each child location as its own weather card.
 *
 * @param {object} props
 * @param {object} props.area              - Parent area object (from API)
 * @param {boolean} props.showLiveWeather  - false for Future Planning (no live data)
 */
export function ParentAreaCard({ area, showLiveWeather }) {
  const [expanded, setExpanded] = usePersistedState(`mygration.area.${area.id}`, true)
  const children = area.children || []
  const childCount = children.length

  return (
    <article className={`parent-area ${expanded ? 'expanded' : 'collapsed'}`}>
      <header className="parent-header" onClick={() => setExpanded(!expanded)}>
        <button
          type="button"
          className="parent-toggle"
          aria-expanded={expanded}
          aria-controls={`parent-body-${area.id}`}
        >
          <span className="chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          <div className="parent-name-block">
            <h3 className="parent-name">{area.name}</h3>
            <span className="parent-meta">
              {childCount} {childCount === 1 ? 'spot' : 'spots'}
            </span>
          </div>
        </button>
        {area.planning_notes && (
          <p className="parent-notes">{area.planning_notes}</p>
        )}
      </header>
      {expanded && (
        <div id={`parent-body-${area.id}`} className="parent-body">
          {children.length === 0 ? (
            <div className="empty-children">No specific spots added yet.</div>
          ) : (
            children.map((child) => (
              <ChildLocationRow
                key={child.id}
                child={child}
                showLiveWeather={showLiveWeather}
              />
            ))
          )}
        </div>
      )}
    </article>
  )
}
