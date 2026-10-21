/** The parents folded in this tab: transient, shared by the list and the
 *  board, so a fold holds across layouts and views (UX.md). Parents start
 *  expanded; a new set on each change keeps it reactive. */
export function useFolded() {
  const folded = useState('folded', () => new Set<string>());
  const set = (id: string, on: boolean) => {
    const next = new Set(folded.value);
    if (on) next.add(id);
    else next.delete(id);
    folded.value = next;
  };
  return {
    isFolded: (id: string) => folded.value.has(id),
    toggle: (id: string) => set(id, !folded.value.has(id)),
    unfold: (id: string) => set(id, false),
  };
}
