import { usePersistedState } from '../hooks/usePersistedState.js'
import { useLocationsStore } from '../hooks/useLocationsStore.jsx'
import { ParentAreaCard } from './ParentAreaCard.jsx'

/**
 * One of the three collapsible buckets on the dashboard.
 *
 * Defaults are decided by the parent (App) based on desktop vs. mobile, but
 * once the user toggles a bucket we persist that per-device so it sticks.
 *
 * @param {object} props
 * @param {string} props.bucketKey     - 'active' | 'watching' | 'future_planning'
 * @param {string} props.title         - Human-readable header
 * @param {string} props.description   - Short explainer shown under the header
 * @param {Array}  props.areas         - List of ParentArea objects in this bucket
 * @param {boolean} props.defaultOpen  - Initial expanded state if user has no preference
 */
export function LocationBucket({ bucketKey, title, description, areas, defaultOpen }) {
  const [open, setOpen] = usePersistedState(`mygration.bucket.${bucketKey}`, defaultOpen)
  const { openAddParent } = useLocationsStore()

  // Click handler for the "Add Area" button. Stops propagation so the bucket
  // header's collapse toggle doesn't fire.
  const handleAdd = (e) => {
    e.stopPropagation()
    openAddParent(bucketKey)
  }

  return (
    <section className={`bucket bucket-${bucketKey} ${open ? 'open' : 'closed'}`}>
      <header className="bucket-header" onClick={() => setOpen(!open)}>
        <button
          type="button"
          className="bucket-toggle"
          aria-expanded={open}
          aria-controls={`bucket-body-${bucketKey}`}
        >
          <span className="chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <h2 className="bucket-title">{title}</h2>
          <span className="bucket-count" aria-label={`${areas.length} areas`}>
            {areas.length}
          </span>
        </button>
        <button
          type="button"
          className="bucket-add"
          onClick={handleAdd}
          aria-label={`Add area to ${title}`}
          title="Add a new area"
        >
          + Add area
        </button>
        <p className="bucket-description">{description}</p>
      </header>
      {open && (
        <div id={`bucket-body-${bucketKey}`} className="bucket-body">
          {areas.length === 0 ? (
            <div className="empty-bucket">
              No locations in this bucket yet.{' '}
              <button type="button" className="empty-bucket-add" onClick={handleAdd}>
                Add one?
              </button>
            </div>
          ) : (
            areas.map((area) => (
              <ParentAreaCard
                key={area.id}
                area={area}
                showLiveWeather={bucketKey !== 'future_planning'}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
}
