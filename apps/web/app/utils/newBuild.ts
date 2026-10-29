/**
 * Reloads onto the newest build. Under the old service worker a plain reload
 * gets the old precached index.html (navigateFallback), so ask the worker to
 * update first and activate the one it installs. `activate` skips waiting and
 * reloads; `reload` is the fallback when there is no new worker to activate.
 */
export async function reloadOntoNewBuild(
  container: ServiceWorkerContainer | undefined,
  activate: () => Promise<void>,
  reload: () => void,
): Promise<void> {
  if (!container?.controller) return reload();
  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await container.getRegistration();
    if (registration === undefined) return reload();
    await registration.update();
  } catch {
    // Offline or the server is gone: the old build is all there is.
    return reload();
  }
  const installing = registration.installing;
  if (installing !== null) await installed(installing);
  if (registration.waiting !== null) return activate();
  reload();
}

const installed = (worker: ServiceWorker) =>
  new Promise<void>((resolve) => {
    const settle = () => {
      if (worker.state === 'installing') return;
      worker.removeEventListener('statechange', settle);
      resolve();
    };
    worker.addEventListener('statechange', settle);
    settle();
  });
