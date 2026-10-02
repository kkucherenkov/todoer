/** Opens a task's drawer: `?task=<id>`, keeping the rest of the query. */
export function useOpenTask() {
  const route = useRoute();
  const router = useRouter();
  return (id: string) => router.push({ query: { ...route.query, task: id } });
}
