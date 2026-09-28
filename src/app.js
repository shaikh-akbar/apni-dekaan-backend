import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import routes from './routes/index.js';
import { AppError } from './utils/AppError.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy (nginx) in production, so req.ip is the real client IP
  app.set('trust proxy', env.isProd ? 1 : false);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  // CSRF defence in depth (cookies are already SameSite=Lax): state-changing requests
  // that carry an Origin header must come from an allowed origin.
  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !env.corsOrigins.includes(origin) && origin !== `${req.protocol}://${req.get('host')}`) {
      return next(AppError.forbidden('Request origin not allowed'));
    }
    next();
  });

  // Uploaded images: served with a strict content type and no script execution
  app.use('/uploads', express.static(env.uploadDir, {
    maxAge: '7d',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
    },
  }));

  app.use('/api', apiLimiter, routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
