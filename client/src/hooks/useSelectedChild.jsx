import { createContext, useCallback, useContext, useState } from 'react'

/**
 * Shared "which child location is currently drilled-in?" state.
 *
 * Lives in context so ChildLocationRow (deep in the tree) can open the detail
 * modal without prop-drilling a callback through two intermediate components.
 *
 * The modal supports two modes:
 *   - 'live'       → hourly forecast, astro, wind (Active / Watching rows)
 *   - 'historical' → research digest by month     (Future Planning rows)
 * Mode is tracked alongside the selected child so the same modal can branch.
 */
const SelectedChildContext = createContext({
  selectedChild: null,
  selectedMode: 'live',
  setSelectedChild: () => {},
})

export function SelectedChildProvider({ children }) {
  const [selectedChild, setSelectedChildState] = useState(null)
  const [selectedMode, setSelectedMode] = useState('live')

  // Setter accepts (child, mode). Pass null to close.
  const setSelectedChild = useCallback((child, mode = 'live') => {
    setSelectedChildState(child)
    setSelectedMode(child ? mode : 'live')
  }, [])

  return (
    <SelectedChildContext.Provider
      value={{ selectedChild, selectedMode, setSelectedChild }}
    >
      {children}
    </SelectedChildContext.Provider>
  )
}

export function useSelectedChild() {
  return useContext(SelectedChildContext)
}
