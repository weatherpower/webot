import { config } from './config.js';

export const requireControllerToken = (req, res, next) => {
  if (!config.controllerToken) {
    next();
    return;
  }

  const token = req.get('x-controller-token') || req.query.token || req.body?.token;
  if (token === config.controllerToken) {
    next();
    return;
  }

  res.status(401).json({
    error: 'Controller token required'
  });
};
