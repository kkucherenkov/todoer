/** The parents folded in this tab: transient, shared by the list and the
 *  board, so a fold holds across layouts and views (UX.md). Parents start
 *  expanded. */
export function useFolded() {
  const folded = useState<string[]>('folded', () => []);
  return {
    isFolded: (id: string) => folded.value.includes(id),
    toggle: (id: string) => {
      folded.value = folded.value.includes(id)
        ? folded.value.filter((f) => f !== id)
        : [...folded.value, id];
    },
  };
}
