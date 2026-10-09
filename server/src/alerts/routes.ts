/**
 * Order Flow Alert REST API Router
 *
 * Implements authenticated endpoints:
 * - POST   /api/v1/alerts/rules       (Create rule, enforces plan limits)
 * - GET    /api/v1/alerts/rules       (List rules for authenticated user)
 * - GET    /api/v1/alerts/rules/:id   (Get single rule)
 * - PUT    /api/v1/alerts/rules/:id   (Update rule properties)
 * - DELETE /api/v1/alerts/rules/:id   (Delete rule)
 * - GET    /api/v1/alerts/history     (List triggered alert history)
 * - POST   /api/v1/alerts/history/:id/ack (Acknowledge alert)
 * - DELETE /api/v1/alerts/history     (Clear alert history)
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { AlertService, alertService as defaultAlertService } from './alertService.js';
import { User } from '../auth/types.js';

export function createAlertRouter(ctx: {
  alertService?: AlertService;
  getUserFromRequest: (req: IncomingMessage) => User | null;
  getUserPlan?: (userId: string) => string;
}) {
  const service = ctx.alertService || defaultAlertService;

  const sendJson = (res: ServerResponse, status: number, data: any): boolean => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(JSON.stringify(data));
    return true;
  };

  const readJsonBody = async (req: IncomingMessage): Promise<any> => {
    if ((req as any).body && typeof (req as any).body === 'object') {
      return (req as any).body;
    }
    if (typeof (req as any)[Symbol.asyncIterator] === 'function') {
      let raw = '';
      for await (const chunk of req as any) {
        raw += chunk.toString();
        if (raw.length > 256 * 1024) {
          throw new Error('Payload too large');
        }
      }
      return raw ? JSON.parse(raw) : {};
    }
    let raw = '';
    return new Promise((resolve, reject) => {
      if (typeof req.on !== 'function') {
        return resolve({});
      }
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 256 * 1024) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  };

  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, {});
    }

    const path = url.pathname;
    if (!path.startsWith('/api/v1/alerts/')) {
      return false;
    }

    // Authentication Guard
    const user = ctx.getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: 'Authentication required to manage alert rules' });
    }

    const userPlan = ctx.getUserPlan ? ctx.getUserPlan(user.id) : (user.role === 'admin' ? 'elite' : 'free');
    const subpath = path.replace('/api/v1/alerts/', '').replace(/\/$/, '');
    const segments = subpath.split('/');

    try {
      // 1. Rules endpoints: /api/v1/alerts/rules
      if (segments[0] === 'rules') {
        const ruleId = segments[1];

        // GET /rules - List rules
        if (req.method === 'GET' && !ruleId) {
          const rules = service.listRules(user.id);
          return sendJson(res, 200, { rules, total: rules.length, count: rules.length });
        }

        // POST /rules - Create rule
        if (req.method === 'POST' && !ruleId) {
          const body = await readJsonBody(req);
          const rule = service.createRule(user.id, userPlan, body);
          return sendJson(res, 201, { ...rule, rule });
        }

        // GET /rules/:id - Get rule
        if (req.method === 'GET' && ruleId) {
          const rule = service.getRule(user.id, ruleId);
          if (!rule) {
            return sendJson(res, 404, { error: 'Alert rule not found' });
          }
          return sendJson(res, 200, { ...rule, rule });
        }

        // PUT / PATCH /rules/:id - Update rule
        if ((req.method === 'PUT' || req.method === 'PATCH') && ruleId) {
          const body = await readJsonBody(req);
          const updated = service.updateRule(user.id, ruleId, body);
          return sendJson(res, 200, { ...updated, rule: updated });
        }

        // DELETE /rules/:id - Delete rule
        if (req.method === 'DELETE' && ruleId) {
          const ok = service.deleteRule(user.id, ruleId);
          if (!ok) {
            return sendJson(res, 404, { error: 'Alert rule not found' });
          }
          return sendJson(res, 200, { success: true, deletedId: ruleId });
        }
      }

      // 2. History endpoints: /api/v1/alerts/history
      if (segments[0] === 'history') {
        const historyId = segments[1];
        const isAck = segments[2] === 'ack';

        // POST /history/:id/ack - Acknowledge alert
        if (req.method === 'POST' && historyId && isAck) {
          const ok = service.acknowledgeAlert(user.id, historyId);
          return sendJson(res, 200, { success: ok, acknowledgedId: historyId });
        }

        // DELETE /history - Clear all history
        if (req.method === 'DELETE' && !historyId) {
          service.clearHistory(user.id);
          return sendJson(res, 200, { success: true });
        }

        // GET /history - List history
        if (req.method === 'GET' && !historyId) {
          const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 50;
          const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : 0;
          const { items, total } = service.getHistory(user.id, limit, offset);
          return sendJson(res, 200, { items, total, limit, offset });
        }
      }

      return sendJson(res, 404, { error: `Unknown alert route: ${subpath}` });
    } catch (err: any) {
      const msg = err?.message || 'Alert request failed';
      const statusCode = msg.includes('Plan limit reached') ? 403 : 400;
      return sendJson(res, statusCode, { error: msg });
    }
  };
}
