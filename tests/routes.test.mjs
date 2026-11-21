import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createTestDatabase } from './helpers/d1.mjs';
import { hashToken, COOKIE_NAME } from '../src/lib/server/auth.ts';
import { handle } from '../src/hooks.server.ts';
import { POST as login } from '../src/routes/api/auth/login/+server.ts';
import { POST as logout } from '../src/routes/api/auth/logout/+server.ts';
import * as dataRoute from '../src/routes/api/data/[...path]/+server.ts';

test('real hooks and route handlers enforce cookie authentication, CSRF, logout and public reads', async () => {
	const fixture = createTestDatabase(['0001_initial.sql', '0002_auth.sql']);
	try {
		const key = randomBytes(32).toString('base64url');
		const env = { DB: fixture.db, OWNER_KEY_HASH: await hashToken(key) };
		let browserCookie;
		let setOptions;
		async function call(
			method,
			path,
			body,
			cookie = browserCookie,
			origin = 'https://notebook.test'
		) {
			const request = new Request('https://notebook.test' + path, {
				method,
				headers: { origin, 'content-type': 'application/json', 'CF-Connecting-IP': 'test-client' },
				...(body === undefined ? {} : { body: JSON.stringify(body) })
			});
			const event = {
				request,
				url: new URL(request.url),
				platform: { env },
				locals: {},
				params: { path: path.replace(/^\/api\/data\/?/, '') },
				cookies: {
					get: (name) => (name === COOKIE_NAME ? cookie : undefined),
					set: (name, value, options) => {
						assert.equal(name, COOKIE_NAME);
						browserCookie = value;
						setOptions = options;
					},
					delete: () => {
						browserCookie = undefined;
					}
				}
			};
			const route =
				path === '/api/auth/login'
					? login
					: path === '/api/auth/logout'
						? logout
						: dataRoute[method];
			return handle({ event, resolve: () => route(event) });
		}
		const before = fixture.sqlite.prepare('SELECT total_changes() AS n').get().n;
		assert.equal((await call('GET', '/api/data')).status, 200);
		assert.equal(fixture.sqlite.prepare('SELECT total_changes() AS n').get().n, before);
		for (const collection of ['folders', 'vocabulary', 'conversations', 'messages']) {
			assert.equal((await call('POST', '/api/data/' + collection, {})).status, 403);
			assert.equal(
				(await call('PATCH', '/api/data/' + collection + '/anything', { version: 1 })).status,
				403
			);
			assert.equal(
				(await call('DELETE', '/api/data/' + collection + '/anything', { version: 1 })).status,
				403
			);
		}
		assert.equal(
			(await call('POST', '/api/auth/login', { key }, undefined, 'https://attacker.test')).status,
			403
		);
		assert.equal((await call('POST', '/api/auth/login', { key: 'wrong' })).status, 401);
		assert.equal((await call('POST', '/api/auth/login', { key })).status, 200);
		assert.deepEqual(setOptions, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			maxAge: 180 * 86400
		});
		const firstCookie = browserCookie;
		const saved = await call('POST', '/api/data/folders', { name: 'Cloud notebook' });
		assert.equal(saved.status, 201);
		const folder = (await saved.json()).item;
		const secondBrowser = await call('GET', '/api/data', undefined, null);
		assert.equal((await secondBrowser.json()).folders[0].id, folder.id);
		assert.equal(
			(
				await call(
					'PATCH',
					'/api/data/folders/' + folder.id,
					{ name: 'Attack', version: folder.version },
					browserCookie,
					'https://attacker.test'
				)
			).status,
			403
		);
		assert.equal((await call('POST', '/api/auth/logout', {})).status, 200);
		assert.equal(
			(await call('POST', '/api/data/folders', { name: 'Denied' }, firstCookie)).status,
			403
		);
		assert.equal((await call('GET', '/api/data', undefined, null)).status, 200);
	} finally {
		fixture.close();
	}
});

test('rotating the owner credential invalidates existing sessions', async () => {
	const fixture = createTestDatabase(['0001_initial.sql', '0002_auth.sql']);
	try {
		const { createSession, authenticate } = await import('../src/lib/server/auth.ts');
		const oldHash = await hashToken('test-key-one');
		const session = await createSession(fixture.db, oldHash, 1000);
		assert.ok(await authenticate(fixture.db, session.cookie, oldHash, 1001));
		assert.equal(
			await authenticate(fixture.db, session.cookie, await hashToken('test-key-two'), 1002),
			null
		);
	} finally {
		fixture.close();
	}
});
