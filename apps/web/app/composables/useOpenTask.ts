/** Opens a task's drawer: `?task=<id>`, keeping the rest of the query. */
export function useOpenTask() {
  const route = useRoute();
  const router = useRouter();
  return (id: string, opener?: HTMLElement) => {
    if (typeof route.query.task !== 'string') {
      const active = document.activeElement;
      rememberDrawerFocus(
        id,
        opener ?? (active instanceof HTMLElement ? active : undefined),
      );
    }
    return router.push({ query: { ...route.query, task: id } });
  };
}
