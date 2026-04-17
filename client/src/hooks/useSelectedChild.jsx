import { createContext, useContext, useState } from 'react'

/**
 * Shared "which child location is currently drilled-in?" state.
 *
 * Lives in context so ChildLocationRow (deep in the tree) can open the detail
 * modal without prop-drilling a callback through two intermediate components.
 */
const SelectedChildContext = createContext({
  selectedChild: null,
  setSelectedChild: () => {},
})

export function SelectedChildProvider({ children }) {
  const [selectedChild, setSelectedChild] = useState(null)
  return (
    <SelectedChildContext.Provider value={{ selectedChild, setSelectedChild }}>
      {children}
    </SelectedChildContext.Provider>
  )
}

export function useSelectedChild() {
  return useContext(SelectedChildContext)
}
