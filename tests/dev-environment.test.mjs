import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { createTestDatabase } from './helpers/d1.mjs';

// Exercise the normal Vite adapter bootstrap. Do not inject event.platform:
// the application's hooks, server loads, and routes must resolve cloudflare:workers.
// Every credential, Wrangler configuration, and persistent database lives in one
// disposable OS temporary directory. Never load the workspace Wrangler config.
test(
	'normal Vite dev resolves isolated Cloudflare bindings for loads, auth, CRUD, and restart',
	{ timeout: 120000 },
	async () => {
		const root = fileURLToPath(new URL('..', import.meta.url));
		const tempRoot = resolve(tmpdir());
		const temporary = await mkdtemp(join(tempRoot, 'improve-tracker-dev-'));
		const configPath = join(temporary, 'wrangler.json');
		const envPath = join(temporary, '.dev.vars');
		const persistPath = join(temporary, 'state');
		const ownerKey = randomBytes(32).toString('base64url');
		const ownerHash = createHash('sha256').update(ownerKey).digest('hex');
		const previousWranglerLog = process.env.WRANGLER_LOG;
		const previousWranglerWriteLogs = process.env.WRANGLER_WRITE_LOGS;
		let server;
		let origin;
		let cookie;

		async function start() {
			server = await createServer({
				root,
				configFile: false,
				cacheDir: join(temporary, 'vite-cache'),
				logLevel: 'silent',
				plugins: [
					sveltekit({
						adapter: adapter({
							config: configPath,
							platformProxy: {
								configPath,
								envFiles: [envPath],
								remoteBindings: false,
								persist: { path: persistPath }
							}
						}),
						preprocess: vitePreprocess()
					})
				],
				server: { host: 'localhost', port: 0, strictPort: false },
				optimizeDeps: { noDiscovery: true, include: [] }
			});
			await server.listen();
			const address = server.httpServer.address();
			assert.ok(
				address && typeof address !== 'string',
				'Vite must listen on a local ephemeral port.'
			);
			origin = 'http://localhost:' + address.port;
		}

		async function request(
			path,
			method = 'GET',
			body,
			authenticated = false,
			requestOrigin = origin
		) {
			const headers = {};
			if (method !== 'GET') {
				headers.origin = requestOrigin;
				headers['content-type'] = 'application/json';
			}
			if (authenticated && cookie) headers.cookie = cookie;
			return fetch(origin + path, {
				method,
				headers,
				redirect: 'manual',
				signal: AbortSignal.timeout(15000),
				...(body === undefined ? {} : { body: JSON.stringify(body) })
			});
		}

		async function snapshot() {
			const response = await request('/api/data');
			assert.equal(
				response.status,
				200,
				'The public data route must resolve the adapter D1 binding.'
			);
			return response.json();
		}

		function counts(data, folders, words, rooms, messages) {
			assert.equal(data.folders.length, folders);
			assert.equal(data.vocabulary.length, words);
			assert.equal(data.conversations.length, rooms);
			assert.equal(data.messages.length, messages);
		}

		async function write(path, method, body, expected = 200) {
			const response = await request('/api/data/' + path, method, body, true);
			assert.equal(
				response.status,
				expected,
				'Authenticated local API mutation must return its expected status.'
			);
			return response.json();
		}

		try {
			process.env.WRANGLER_LOG = 'error';
			process.env.WRANGLER_WRITE_LOGS = 'false';
			await mkdir(join(temporary, 'assets'));
			await writeFile(
				join(temporary, 'worker.js'),
				'export default { fetch() { return new Response("Local integration test"); } };\n'
			);
			await writeFile(envPath, 'OWNER_KEY_HASH=' + ownerHash + '\n', { mode: 0o600 });
			await writeFile(
				configPath,
				JSON.stringify({
					name: 'improve-tracker-local-integration',
					main: join(temporary, 'worker.js'),
					compatibility_date: '2026-10-24',
					compatibility_flags: ['nodejs_compat'],
					workers_dev: false,
					preview_urls: false,
					d1_databases: [
						{
							binding: 'DB',
							database_name: 'isolated-dev-test',
							database_id: randomUUID(),
							remote: false
						}
					],
					assets: { binding: 'ASSETS', directory: join(temporary, 'assets') }
				})
			);
			await start();
			const { getEnvironment } = await server.ssrLoadModule('/src/lib/server/environment.ts');
			const env = await getEnvironment();
			assert.ok(env.DB, 'The real adapter virtual environment must expose D1.');
			assert.ok(env.OWNER_KEY_HASH === ownerHash, 'Only the temporary owner hash may be loaded.');
			const existingSchema = await env.DB.prepare(
				"SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('folders', 'vocabulary', 'conversations', 'messages', 'sessions')"
			).first('count');
			assert.equal(
				existingSchema,
				0,
				'Refuse to apply test migrations to any previously initialized database.'
			);
			const schema = createTestDatabase(['0001_initial.sql', '0002_auth.sql']);
			try {
				const statements = schema.sqlite
					.prepare('SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid')
					.all();
				await env.DB.batch(statements.map(({ sql }) => env.DB.prepare(sql)));
			} finally {
				schema.close();
			}

			counts(await snapshot(), 0, 0, 0, 0);
			const demoResponse = await request('/');
			assert.equal(demoResponse.status, 200);
			const demo = await demoResponse.text();
			assert.ok(
				demo.includes('Owner sign-in'),
				'The server load must resolve the temporary owner configuration.'
			);
			assert.ok(
				demo.includes('Read-only demo') && !demo.includes('Notebook unavailable'),
				'The normal dev notebook must be connected.'
			);
			const loginPageResponse = await request('/login');
			assert.equal(loginPageResponse.status, 200);
			const loginPage = await loginPageResponse.text();
			assert.ok(
				loginPage.includes('id="owner-key"'),
				'Owner sign-in must expose its configured input.'
			);
			assert.ok(
				!loginPage.includes(ownerKey) && !loginPage.includes(ownerHash),
				'Credentials must never be rendered.'
			);

			assert.equal(
				(
					await request(
						'/api/auth/login',
						'POST',
						{ key: ownerKey },
						false,
						'https://untrusted.example'
					)
				).status,
				403
			);
			const login = await request('/api/auth/login', 'POST', { key: ownerKey });
			assert.equal(
				login.status,
				200,
				'A temporary valid owner key must sign in through the normal Vite routes.'
			);
			const setCookie = login.headers.get('set-cookie');
			assert.ok(
				setCookie?.includes('HttpOnly') &&
					setCookie.includes('Secure') &&
					setCookie.includes('SameSite=Strict')
			);
			cookie = setCookie.split(';', 1)[0];
			const session = await request('/api/auth/session', 'GET', undefined, true);
			assert.equal(session.status, 200);
			assert.equal(
				(await session.json()).isOwner,
				true,
				'The real server hook must authenticate the local session.'
			);
			assert.equal(
				(
					await request(
						'/api/data/folders',
						'POST',
						{ name: 'Forbidden' },
						true,
						'https://untrusted.example'
					)
				).status,
				403
			);
			counts(await snapshot(), 0, 0, 0, 0);

			const folder = (await write('folders', 'POST', { name: 'First folder' }, 201)).item;
			const otherFolder = (await write('folders', 'POST', { name: 'Second folder' }, 201)).item;
			await write('folders/' + folder.id, 'PATCH', {
				name: 'Renamed folder',
				version: folder.version
			});
			const wordDraft = {
				word: 'Improve',
				meaning: '上達する',
				example: 'I improve every day.',
				translation: '毎日上達する。',
				notes: 'Temporary integration data.'
			};
			const word = (await write('vocabulary', 'POST', { ...wordDraft, folder_id: folder.id }, 201))
				.item;
			const updatedWord = (
				await write('vocabulary/' + word.id, 'PATCH', {
					...wordDraft,
					notes: 'Edited temporary note.',
					folder_id: otherFolder.id,
					version: word.version
				})
			).item;
			await write(
				'vocabulary/' + word.id,
				'PATCH',
				{ ...wordDraft, folder_id: folder.id, version: word.version },
				409
			);

			const room = (
				await write(
					'conversations',
					'POST',
					{ title: 'First room', description: 'Temporary practice.' },
					201
				)
			).item;
			const otherRoom = (
				await write('conversations', 'POST', { title: 'Second room', description: '' }, 201)
			).item;
			await write('conversations/' + room.id, 'PATCH', {
				title: 'Renamed room',
				description: 'Edited description.',
				version: room.version
			});
			const message = (
				await write(
					'messages',
					'POST',
					{ conversation_id: room.id, speaker: 'me', content: 'Hello.' },
					201
				)
			).item;
			const updatedMessage = (
				await write('messages/' + message.id, 'PATCH', {
					conversation_id: otherRoom.id,
					speaker: 'partner',
					content: 'Hello again.',
					version: message.version
				})
			).item;
			let data = await snapshot();
			counts(data, 2, 1, 2, 1);
			assert.ok(
				data.vocabulary[0].folder_id === otherFolder.id &&
					data.vocabulary[0].notes === 'Edited temporary note.'
			);
			assert.ok(
				data.messages[0].conversation_id === otherRoom.id && data.messages[0].speaker === 'partner'
			);
			const ownerPageResponse = await request('/', 'GET', undefined, true);
			assert.equal(ownerPageResponse.status, 200);
			assert.ok(
				(await ownerPageResponse.text()).includes('Owner mode'),
				'The actual owner server load must see the authenticated hook.'
			);

			await server.close();
			server = null;
			await start();
			data = await snapshot();
			counts(data, 2, 1, 2, 1);
			assert.ok(
				data.vocabulary[0].id === word.id && data.vocabulary[0].notes === 'Edited temporary note.',
				'Temporary D1 data must survive a Vite restart.'
			);
			const restartedSession = await request('/api/auth/session', 'GET', undefined, true);
			assert.equal(restartedSession.status, 200);
			assert.equal(
				(await restartedSession.json()).isOwner,
				true,
				'Temporary D1 sessions must survive a Vite restart.'
			);
			await write('vocabulary/' + word.id, 'DELETE', { version: updatedWord.version });
			await write('messages/' + message.id, 'DELETE', { version: updatedMessage.version });
			await write('vocabulary', 'POST', { ...wordDraft, folder_id: folder.id }, 201);
			await write(
				'messages',
				'POST',
				{ conversation_id: room.id, speaker: 'me', content: 'Cascade check.' },
				201
			);
			data = await snapshot();
			await write('folders/' + folder.id, 'DELETE', {
				version: data.folders.find((item) => item.id === folder.id).version
			});
			await write('conversations/' + room.id, 'DELETE', {
				version: data.conversations.find((item) => item.id === room.id).version
			});
			data = await snapshot();
			counts(data, 1, 0, 1, 0);
			await write('folders/' + otherFolder.id, 'DELETE', { version: data.folders[0].version });
			await write('conversations/' + otherRoom.id, 'DELETE', {
				version: data.conversations[0].version
			});
			counts(await snapshot(), 0, 0, 0, 0);

			assert.equal(
				(await request('/api/auth/logout', 'POST', {}, true, 'https://untrusted.example')).status,
				403
			);
			assert.equal((await request('/api/auth/logout', 'POST', {}, true)).status, 200);
			assert.equal(
				(await (await request('/api/auth/session', 'GET', undefined, true)).json()).isOwner,
				false
			);
			for (const collection of ['folders', 'vocabulary', 'conversations', 'messages']) {
				for (const method of ['POST', 'PATCH', 'DELETE']) {
					const path = '/api/data/' + collection + (method === 'POST' ? '' : '/missing');
					assert.equal((await request(path, method, {}, false)).status, 403);
					assert.equal(
						(await request(path, method, {}, true)).status,
						403,
						'A revoked session must not grant edit access.'
					);
				}
			}
			counts(await snapshot(), 0, 0, 0, 0);
		} finally {
			await server?.close();
			assert.equal(dirname(temporary), tempRoot);
			assert.ok(basename(temporary).startsWith('improve-tracker-dev-'));
			await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
			if (previousWranglerLog === undefined) delete process.env.WRANGLER_LOG;
			else process.env.WRANGLER_LOG = previousWranglerLog;
			if (previousWranglerWriteLogs === undefined) delete process.env.WRANGLER_WRITE_LOGS;
			else process.env.WRANGLER_WRITE_LOGS = previousWranglerWriteLogs;
		}
	}
);
