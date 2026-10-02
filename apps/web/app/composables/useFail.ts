import type { Result } from '~/db/protocol';

/** Shows a refused write as a toast; the kind picks the words. */
export function useFail() {
  const toast = useToast();
  const { t } = useI18n();
  return (result: Extract<Result, { ok: false }>) =>
    toast.add({
      color: 'error',
      title: t(`errors.${result.failure.kind}`),
      description: result.failure.detail,
    });
}
