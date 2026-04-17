import { usePersistedState } from '../hooks/usePersistedState.js'
import { useLocationsStore } from '../hooks/useLocationsStore.jsx'
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
  const { openEditParent, openAddChild, deleteParent } = useLocationsStore()

  const children = area.children || []
  const childCount = children.length

  // Action buttons must not bubble up and collapse the card.
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }

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
          <span className="location-icon parent-icon" aria-hidden="true">
            <svg viewBox="0 0 16 20" fill="currentColor" width="100%" height="100%">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 5.25 7 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8zm0 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" />
            </svg>
          </span>
        </button>
        <div className="parent-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={stop(() => openEditParent(area))}
            aria-label={`Edit ${area.name}`}
            title="Edit area"
          >
            ✎
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            onClick={stop(() => deleteParent(area))}
            aria-label={`Delete ${area.name}`}
            title="Delete area"
          >
            ×
          </button>
        </div>
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
                parentName={area.name}
                showLiveWeather={showLiveWeather}
              />
            ))
          )}
          <button
            type="button"
            className="add-child-btn"
            onClick={() => openAddChild(area.id, area.name)}
          >
            + Add spot
          </button>
        </div>
      )}
    </article>
  )
}
