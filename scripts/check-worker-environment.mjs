// Run after `pnpm build`: node scripts/check-worker-environment.mjs
// The actual Cloudflare adapter Worker runs in workerd with an isolated, in-memory D1.
// No Wrangler config, .dev.vars, persisted database, or remote resource is loaded.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestDatabase } from '../tests/helpers/d1.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const dependencyRoot = dirname(require.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(
	pathToFileURL(require.resolve('miniflare', { paths: [dependencyRoot] })).href
);
const { build } = await import(
	pathToFileURL(require.resolve('esbuild', { paths: [dependencyRoot] })).href
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'improve-worker-environment-'));
let runtime;

async function removeTemporaryDirectory() {
	const target = await realpath(temporaryDirectory);
	const temporaryRoot = await realpath(tmpdir());
	const childPath = relative(temporaryRoot, target);
	if (
		!childPath ||
		childPath.startsWith('..') ||
		isAbsolute(childPath) ||
		!basename(target).startsWith('improve-worker-environment-')
	) {
		throw new Error('Refusing to remove an unexpected temporary directory.');
	}
	await rm(target, { recursive: true, force: true });
}

try {
	const bundle = join(temporaryDirectory, 'worker.mjs');
	await build({
		entryPoints: [join(root, '.svelte-kit/cloudflare/_worker.js')],
		outfile: bundle,
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		conditions: ['workerd', 'worker', 'browser', 'production'],
		external: ['node:*', 'cloudflare:*'],
		logLevel: 'silent'
	});
	// These credentials exist only for this process and are never printed or written to disk.
	const ownerKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
	const ownerHash = Buffer.from(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ownerKey))
	).toString('hex');
	runtime = new Miniflare(
		convertV4MiniflareOptions({
			name: 'isolated-environment-check',
			host: '127.0.0.1',
			modules: true,
			scriptPath: bundle,
			// An omitted modulesRoot makes a bundle outside cwd resolve to a ../ module name.
			// workerd rejects that name with an opaque startup error on the installed runtime.
			modulesRoot: temporaryDirectory,
			compatibilityDate: '2026-10-24',
			compatibilityFlags: ['nodejs_compat'],
			bindings: { OWNER_KEY_HASH: ownerHash },
			d1Databases: { DB: crypto.randomUUID() },
			d1Persist: false,
			log: new Log(LogLevel.ERROR)
		})
	);
	const db = await runtime.getD1Database('DB');
	const schema = createTestDatabase(['0001_initial.sql', '0002_auth.sql']);
	try {
		await db.batch(
			schema.sqlite
				.prepare('SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid')
				.all()
				.map(({ sql }) => db.prepare(sql))
		);
	} finally {
		schema.close();
	}

	const origin = 'https://isolated-worker.example';
	const request = (path, { method = 'GET', body, cookie, requestOrigin = origin } = {}) =>
		runtime.dispatchFetch(origin + path, {
			method,
			headers: {
				...(method === 'GET' ? {} : { origin: requestOrigin, 'content-type': 'application/json' }),
				...(cookie ? { cookie } : {})
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
	const page = await request('/');
	assert.equal(
		page.status,
		200,
		`The built Worker must render the notebook (HTTP ${page.status}).`
	);
	const html = await page.text();
	assert.ok(html.includes('Improve Tracker'), 'The notebook HTML must be present.');
	// Static assets are outside this binding/authentication smoke check.
	console.log('Built Worker SSR: passed.');

	const guestData = await request('/api/data');
	assert.equal(guestData.status, 200, 'Guest reads must resolve the D1 binding.');
	assert.deepEqual(await guestData.json(), {
		folders: [],
		vocabulary: [],
		conversations: [],
		messages: []
	});
	const guestWrite = await request('/api/data/folders', {
		method: 'POST',
		body: { name: 'Denied guest write' }
	});
	assert.equal(guestWrite.status, 403, 'Guest writes must be rejected.');
	const loginPage = await request('/login');
	assert.equal(loginPage.status, 200, 'The login page must render with the Worker bindings.');

	const login = await request('/api/auth/login', { method: 'POST', body: { key: ownerKey } });
	assert.equal(login.status, 200, 'Owner sign-in must resolve both D1 and the owner secret.');
	const header = login.headers.get('set-cookie');
	assert.ok(
		header?.includes('HttpOnly') &&
			header.includes('Secure') &&
			header.includes('SameSite=Strict') &&
			/Max-Age=\d+/i.test(header),
		'Sign-in must issue a secure, persistent session cookie.'
	);
	const cookie = header.split(';', 1)[0];
	const session = await request('/api/auth/session', { cookie });
	assert.equal(session.status, 200);
	assert.equal(
		(await session.json()).isOwner,
		true,
		'The hook must authenticate the owner cookie.'
	);
	assert.equal(
		session.headers.has('set-cookie'),
		false,
		'Ordinary reads must not reissue old tokens.'
	);
	console.log('D1 binding, guest authorization, and owner sign-in: passed.');

	const folderResponse = await request('/api/data/folders', {
		method: 'POST',
		cookie,
		body: { name: 'Isolated folder' }
	});
	assert.equal(folderResponse.status, 201, 'Authenticated writes must reach D1.');
	const folder = (await folderResponse.json()).item;
	const wordResponse = await request('/api/data/vocabulary', {
		method: 'POST',
		cookie,
		body: { folder_id: folder.id, word: 'Practice', meaning: '練習する' }
	});
	assert.equal(wordResponse.status, 201);
	const roomResponse = await request('/api/data/conversations', {
		method: 'POST',
		cookie,
		body: { title: 'Isolated conversation' }
	});
	assert.equal(roomResponse.status, 201);
	const room = (await roomResponse.json()).item;
	for (const content of ['Hello.', 'How are you?']) {
		const message = await request('/api/data/messages', {
			method: 'POST',
			cookie,
			body: { conversation_id: room.id, speaker: 'me', content }
		});
		assert.equal(message.status, 201);
	}
	const snapshot = await (await request('/api/data')).json();
	assert.equal(snapshot.folders.length, 1);
	assert.equal(snapshot.vocabulary.length, 1);
	assert.equal(snapshot.conversations.length, 1);
	assert.deepEqual(
		snapshot.messages.map(({ content, sort_order }) => ({ content, sort_order })),
		[
			{ content: 'Hello.', sort_order: 0 },
			{ content: 'How are you?', sort_order: 1 }
		]
	);
	const crossSite = await request('/api/data/folders', {
		method: 'POST',
		cookie,
		requestOrigin: 'https://other.example',
		body: { name: 'Denied cross-origin write' }
	});
	assert.equal(crossSite.status, 403);
	const logout = await request('/api/auth/logout', { method: 'POST', cookie, body: {} });
	assert.equal(logout.status, 200);
	const revoked = await request('/api/auth/session', { cookie });
	assert.equal(
		(await revoked.json()).isOwner,
		false,
		'Logout must revoke the server-side session.'
	);
	const revokedWrite = await request('/api/data/folders', {
		method: 'POST',
		cookie,
		body: { name: 'Denied revoked session' }
	});
	assert.equal(revokedWrite.status, 403);
	console.log('Authenticated D1 writes, message order, CSRF, and logout revocation: passed.');
	console.log('Worker environment checks passed. No persisted or remote data was accessed.');
} catch (error) {
	console.error(
		`Worker environment check failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`
	);
	process.exitCode = 1;
} finally {
	try {
		await runtime?.dispose();
	} finally {
		await removeTemporaryDirectory();
	}
}
