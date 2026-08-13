import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loopbackCallback } from '../../src/main/connector-service';

interface LocalResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function localRequest(
  value: string,
  options: { method?: string; hostHeader?: string } = {},
): Promise<LocalResponse> {
  const url = new URL(value);
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: '127.0.0.1',
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? 'GET',
        headers: { host: options.hostHeader ?? url.host },
      },
      (incoming) => {
        incoming.setEncoding('utf8');
        let body = '';
        incoming.on('data', (chunk: string) => {
          body += chunk;
        });
        incoming.once('end', () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body,
          }),
        );
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}

describe('OAuth loopback callback lifecycle', () => {
  it('ignores probes and accepts one exact state-bearing callback with hardened headers', async () => {
    const result = await loopbackCallback(
      'google',
      'founder-owned-client',
      undefined,
      'minimum',
      async (authorizationUrl) => {
        const authorization = new URL(authorizationUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
        const state = authorization.searchParams.get('state')!;

        await expect(localRequest(redirect.toString(), { method: 'POST' })).resolves.toMatchObject({
          status: 405,
        });
        await expect(
          localRequest(redirect.toString(), { hostHeader: 'attacker.example' }),
        ).resolves.toMatchObject({ status: 400 });

        const wrongPath = new URL('/favicon.ico', redirect);
        await expect(localRequest(wrongPath.toString())).resolves.toMatchObject({ status: 404 });

        const forged = new URL(redirect);
        forged.searchParams.set('code', 'attacker-code');
        forged.searchParams.set('state', 'forged-state');
        await expect(localRequest(forged.toString())).resolves.toMatchObject({ status: 400 });

        const missingResult = new URL(redirect);
        missingResult.searchParams.set('state', state);
        await expect(localRequest(missingResult.toString())).resolves.toMatchObject({
          status: 400,
        });

        const valid = new URL(redirect);
        valid.searchParams.set('code', 'provider-code');
        valid.searchParams.set('state', state);
        const response = await localRequest(valid.toString());
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['content-security-policy']).toContain("default-src 'none'");
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.body).not.toContain('provider-code');
      },
    );

    const callback = new URL(result.callbackUrl);
    expect(callback.origin).toBe(new URL(result.prepared.redirectUri).origin);
    expect(callback.pathname).toBe('/oauth/callback');
    expect(callback.searchParams.get('code')).toBe('provider-code');
    expect(callback.searchParams.get('state')).toBe(result.prepared.state);
  });

  it('clears the callback timer and closes the listener when opening the browser fails', async () => {
    await expect(
      loopbackCallback(
        'google',
        'founder-owned-client',
        undefined,
        'minimum',
        async () => {
          throw new Error('browser unavailable');
        },
        undefined,
        20,
      ),
    ).rejects.toThrow('browser unavailable');

    // If cleanup failed, the abandoned promise rejects after this delay and
    // Vitest reports an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('advertises localhost for Microsoft while the listener remains on IPv4 loopback', async () => {
    const result = await loopbackCallback(
      'microsoft',
      'founder-owned-microsoft-client',
      'common',
      'minimum',
      async (authorizationUrl) => {
        const authorization = new URL(authorizationUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
        expect(redirect.hostname).toBe('localhost');
        const callback = new URL(redirect);
        callback.searchParams.set('code', 'microsoft-provider-code');
        callback.searchParams.set('state', authorization.searchParams.get('state')!);
        await expect(localRequest(callback.toString())).resolves.toMatchObject({ status: 200 });
      },
    );

    expect(new URL(result.prepared.redirectUri).hostname).toBe('localhost');
    expect(new URL(result.callbackUrl).searchParams.get('code')).toBe('microsoft-provider-code');
  });
});
