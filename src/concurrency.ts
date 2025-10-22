type Task<T> = () => Promise<T>;

export function pLimit(concurrency: number) {
  if (concurrency < 1) {
    throw new Error('pLimit concurrency must be at least 1');
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (!queue.length || activeCount >= concurrency) return;
    const run = queue.shift();
    if (!run) return;
    run();
  };

  return <T>(task: Task<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const execute = () => {
        activeCount += 1;
        task()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            activeCount -= 1;
            next();
          });
      };

      if (activeCount < concurrency) {
        execute();
      } else {
        queue.push(execute);
      }
    });
}
