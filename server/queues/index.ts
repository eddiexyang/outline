import { createQueue } from "@server/queues/queue";
import { Second } from "@shared/utils/time";

let cachedGlobalEventQueue: ReturnType<typeof createQueue> | undefined;
export const globalEventQueue = () => {
  if (!cachedGlobalEventQueue) {
    cachedGlobalEventQueue = createQueue("globalEvents", {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: Second.ms,
      },
    });
  }
  return cachedGlobalEventQueue;
};

let cachedProcessorEventQueue: ReturnType<typeof createQueue> | undefined;
export const processorEventQueue = () => {
  if (!cachedProcessorEventQueue) {
    cachedProcessorEventQueue = createQueue("processorEvents", {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 10 * Second.ms,
      },
    });
  }
  return cachedProcessorEventQueue;
};

let cachedWebsocketQueue: ReturnType<typeof createQueue> | undefined;
export const websocketQueue = () => {
  if (!cachedWebsocketQueue) {
    cachedWebsocketQueue = createQueue("websockets", {
      timeout: 10 * Second.ms,
    });
  }
  return cachedWebsocketQueue;
};

let cachedTaskQueue: ReturnType<typeof createQueue> | undefined;
export const taskQueue = () => {
  if (!cachedTaskQueue) {
    cachedTaskQueue = createQueue("tasks", {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 10 * Second.ms,
      },
    });
  }
  return cachedTaskQueue;
};

export const closeAllQueuesForTest = async () => {
  const queues = [
    cachedGlobalEventQueue,
    cachedProcessorEventQueue,
    cachedWebsocketQueue,
    cachedTaskQueue,
  ].filter(Boolean) as Array<ReturnType<typeof createQueue> | undefined>;

  await Promise.allSettled(
    queues.map(async (queue) => {
      if (queue && "close" in queue && typeof queue.close === "function") {
        await queue.close();
      }
    })
  );

  cachedGlobalEventQueue = undefined;
  cachedProcessorEventQueue = undefined;
  cachedWebsocketQueue = undefined;
  cachedTaskQueue = undefined;
};
