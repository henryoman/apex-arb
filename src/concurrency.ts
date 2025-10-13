type Task<T> = () => Promise<T>;

interface QueueItem<T> {
  task: Task<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
}

export function pLimit(concurrency: number) {
  if (concurrency < 1) {
    throw new Error('pLimit concurrency must be at least 1');
  }

  let activeCount = 0;
  const queue: Array<QueueItem<unknown>> = [];

  const next = () => {
    if (!queue.length || activeCount >= concurrency) return;
    const item = queue.shift();
    if (!item) return;

    activeCount += 1;
    const { task, resolve, reject } = item;

    task()
      .then((value) => {
        activeCount -= 1;
        resolve(value);
        next();
      })
      .catch((error) => {
        activeCount -= 1;
        reject(error);
        next();
      });
  };

  return <T>(task: Task<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}
