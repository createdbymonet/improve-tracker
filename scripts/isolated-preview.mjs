// Test-only Node SSR preview backed by workerd's isolated in-memory D1.
// This verifies the built SvelteKit app, not the Cloudflare adapter's Worker bootstrap.
// Run `pnpm build` first, then `node scripts/isolated-preview.mjs`.
// Add --check to run the isolated HTTP assertions and exit.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestDatabase } from '../tests/helpers/d1.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const assetsRoot = resolve(root, '.svelte-kit/cloudflare');
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(
	pathToFileURL(
		require.resolve('miniflare', { paths: [dirname(require.resolve('wrangler/package.json'))] })
	).href
);
const runtime = new Miniflare(
	convertV4MiniflareOptions({
		modules: true,
		script: 'export default { fetch() { return new Response("Isolated D1"); } };',
		compatibilityDate: '2026-10-24',
		d1Databases: { DB: crypto.randomUUID() },
		d1Persist: false,
		log: new Log(LogLevel.ERROR)
	})
);
let httpServer;
async function dispose() {
	if (httpServer?.listening) await new Promise((done) => httpServer.close(done));
	await runtime.dispose();
}
async function assetResponse(url) {
	const pathname = decodeURIComponent(new URL(url).pathname);
	const path = resolve(assetsRoot, '.' + pathname);
	if (!path.startsWith(resolve(assetsRoot, '_app') + sep) || !pathname.startsWith('/_app/'))
		return new Response(null, { status: 404 });
	try {
		const bytes = await readFile(path);
		const type = path.endsWith('.js')
			? 'text/javascript'
			: path.endsWith('.css')
				? 'text/css'
				: path.endsWith('.svg')
					? 'image/svg+xml'
					: 'application/octet-stream';
		return new Response(bytes, { headers: { 'content-type': type } });
	} catch {
		return new Response(null, { status: 404 });
	}
}
try {
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
	const now = Date.now();
	await db.batch([
		db
			.prepare('INSERT INTO folders(id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?)')
			.bind('demo-folder', 'Everyday English', 0, now, now),
		db
			.prepare(
				'INSERT INTO vocabulary(id,folder_id,word,example,meaning,translation,notes,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
			)
			.bind(
				'demo-word',
				'demo-folder',
				'Make progress',
				'A little practice helps us make progress.',
				'前進する、上達する',
				'少しの練習が上達につながります。',
				'An isolated preview example.',
				0,
				now,
				now
			),
		db
			.prepare(
				'INSERT INTO conversations(id,title,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)'
			)
			.bind('demo-room', 'At the café', 'Practice a short everyday conversation.', 0, now, now),
		db
			.prepare(
				'INSERT INTO messages(id,conversation_id,speaker,content,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
			)
			.bind('demo-message-1', 'demo-room', 'partner', 'What would you like to order?', 0, now, now),
		db
			.prepare(
				'INSERT INTO messages(id,conversation_id,speaker,content,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
			)
			.bind('demo-message-2', 'demo-room', 'me', 'A cappuccino, please.', 1, now, now)
	]);
	const ownerKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
	const ownerHash = Buffer.from(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ownerKey))
	).toString('hex');
	const env = { DB: db, OWNER_KEY_HASH: ownerHash, ASSETS: { fetch: (url) => assetResponse(url) } };
	const { server } = await import(
		pathToFileURL(resolve(root, '.svelte-kit/cloudflare-tmp/server.js')).href
	);
	await server.init({
		env,
		read: async (file) => (await assetResponse(`http://localhost/${file}`)).body
	});
	const respond = async (request) =>
		new URL(request.url).pathname.startsWith('/_app/')
			? assetResponse(request.url)
			: server.respond(request, {
					platform: { env, context: { waitUntil() {} } },
					getClientAddress: () => '127.0.0.1'
				});
	const origin = 'https://isolated-preview.example';
	const login = await respond(
		new Request(`${origin}/api/auth/login`, {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body: JSON.stringify({ key: ownerKey })
		})
	);
	assert.equal(login.status, 200, 'Owner sign-in should work in built SvelteKit SSR.');
	const header = login.headers.get('set-cookie');
	assert.ok(
		header?.includes('HttpOnly') && header.includes('Secure') && header.includes('SameSite=Strict')
	);
	const cookie = header.split(';', 1)[0];
	const session = await respond(new Request(`${origin}/api/auth/session`, { headers: { cookie } }));
	assert.equal((await session.json()).isOwner, true);
	const ownerCreate = await respond(
		new Request(`${origin}/api/data/folders`, {
			method: 'POST',
			headers: { origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Temporary auth check' })
		})
	);
	assert.equal(ownerCreate.status, 201);
	const temporaryFolder = (await ownerCreate.json()).item;
	const ownerDelete = await respond(
		new Request(`${origin}/api/data/folders/${temporaryFolder.id}`, {
			method: 'DELETE',
			headers: { origin, cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ version: temporaryFolder.version })
		})
	);
	assert.equal(ownerDelete.status, 200);
	const guest = await respond(
		new Request(`${origin}/api/data/folders`, {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Denied' })
		})
	);
	assert.ok([401, 403].includes(guest.status));
	const page = await respond(new Request(origin));
	assert.equal(page.status, 200);
	assert.ok((await page.text()).includes('Improve Tracker'));
	httpServer = createServer(async (incoming, outgoing) => {
		try {
			const parts = [];
			let length = 0;
			for await (const part of incoming) {
				length += part.length;
				if (length > 192 * 1024) {
					outgoing.writeHead(413).end();
					return;
				}
				parts.push(part);
			}
			const method = incoming.method ?? 'GET';
			const request = new Request(`http://127.0.0.1:${httpServer.address().port}${incoming.url}`, {
				method,
				headers: incoming.headers,
				...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(parts) } : {})
			});
			const response = await respond(request);
			outgoing.writeHead(response.status, Object.fromEntries(response.headers));
			outgoing.end(Buffer.from(await response.arrayBuffer()));
		} catch {
			outgoing.writeHead(500).end('Preview request failed.');
		}
	});
	await new Promise((done) => httpServer.listen(0, '127.0.0.1', done));
	if (process.argv.includes('--check')) {
		await dispose();
		console.log('Isolated SSR checks passed.');
	} else {
		console.log(`http://127.0.0.1:${httpServer.address().port}`);
		process.once('SIGINT', () => {
			void dispose().finally(() => process.exit(0));
		});
		process.once('SIGTERM', () => {
			void dispose().finally(() => process.exit(0));
		});
	}
} catch (error) {
	await dispose().catch(() => {});
	console.error(
		`Isolated preview failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`
	);
	process.exitCode = 1;
}
