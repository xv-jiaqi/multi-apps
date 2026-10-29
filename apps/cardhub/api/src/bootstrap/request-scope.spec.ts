import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import * as Sentry from '@sentry/node';
import { bindRequestScope, currentRequestId, withRequestId } from './request-scope';

describe('request scope', () => {
  it('stores the request id for Sentry events emitted during the request', () => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    Object.assign(req, { id: 'edge-1' });
    const res = new ServerResponse(req);

    bindRequestScope(req, res, () => {
      expect(currentRequestId()).toBe('edge-1');
      expect(Sentry.getIsolationScope().getScopeData().tags.request_id).toBe('edge-1');
      expect(withRequestId({ tags: { path: '/health' } }).tags).toEqual({
        path: '/health',
        request_id: 'edge-1',
      });
    });

    expect(currentRequestId()).toBeUndefined();
    expect(res.getHeader('X-Request-Id')).toBe('edge-1');
    socket.destroy();
  });

  it('does not invent a second id when pino did not assign one', () => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    const res = new ServerResponse(req);
    let continued = false;

    bindRequestScope(req, res, () => {
      continued = true;
      expect(currentRequestId()).toBeUndefined();
    });

    expect(continued).toBe(true);
    expect(res.getHeader('X-Request-Id')).toBeUndefined();
    socket.destroy();
  });
});
