import { Queue } from 'bullmq';
import { createRedis } from './redis.js';

export const QUEUE_NAME = 'orders';

export const orderQueue = new Queue(QUEUE_NAME, {
  connection: createRedis('queue'),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});

export const enqueueOrder = (orderId) => orderQueue.add('process-order', { orderId });
