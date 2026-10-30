import cookieParser from 'cookie-parser';
import express from 'express';
import { errorHandler, identify, loadUser, notFound, observe } from './middleware.js';
import { authRouter } from './routes/auth.js';
import { createHealthRouter } from './routes/health.js';
import { opsRouter } from './routes/ops.js';
import { ordersRouter } from './routes/orders.js';
import { productsRouter } from './routes/products.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // One hop only: the gateway. Anything further back in X-Forwarded-For is client-supplied.
  app.set('trust proxy', 1);

  app.use(identify);
  app.use(observe);
  app.use(createHealthRouter());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadUser);

  app.use('/api/auth', authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api', opsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
