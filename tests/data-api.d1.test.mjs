import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleDataRequest } from '../src/lib/server/data-api.ts';
import { loadSnapshot } from '../src/lib/server/db.ts';
import { createTestDatabase } from './helpers/d1.mjs';

// Exercise Wrangler's installed local D1 implementation, with no persisted database.
const require = createRequire(import.meta.url);
const miniflarePath = require.resolve('miniflare', {
	paths: [dirname(require.resolve('wrangler/package.json'))]
});
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflarePath).href);

async function setup(t) {
	const runtime = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: 'export default { fetch() { return new Response("D1 test"); } };',
			compatibilityDate: '2026-10-24',
			d1Databases: { DB: crypto.randomUUID() },
			d1Persist: false
		})
	);
	t.after(() => runtime.dispose());
	const db = await runtime.getD1Database('DB');
	const schema = createTestDatabase();
	try {
		const statements = schema.sqlite
			.prepare('SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid')
			.all();
		await db.batch(statements.map(({ sql }) => db.prepare(sql)));
	} finally {
		schema.close();
	}
	const api = async (method, path, data) => {
		const request = new Request(`https://notebook.example/api/data/${path}`, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(data)
		});
		const response = await handleDataRequest(db, request, path, true);
		return { status: response.status, body: await response.json() };
	};
	return { db, api };
}

test('local D1 serializes simultaneous creates/edits and keeps trigger/CASCADE versions safe', async (t) => {
	const { db, api } = await setup(t);
	const room = (await api('POST', 'conversations', { title: 'Concurrent' })).body.item;
	const responses = await Promise.all(
		Array.from({ length: 16 }, (_, i) =>
			api('POST', 'messages', {
				conversation_id: room.id,
				speaker: i % 2 ? 'partner' : 'me',
				content: `Message ${i}`
			})
		)
	);
	assert.ok(responses.every(({ status }) => status === 201));
	let snapshot = await loadSnapshot(db);
	assert.deepEqual(
		snapshot.messages.map(({ sort_order }) => sort_order),
		Array.from({ length: 16 }, (_, i) => i)
	);
	assert.equal(snapshot.conversations[0].version, 17);
	assert.equal(snapshot.conversations[0].message_count, 16);
	const target = snapshot.messages[0];
	const edits = await Promise.all([
		api('PATCH', `messages/${target.id}`, { content: 'First editor', version: 1 }),
		api('PATCH', `messages/${target.id}`, { content: 'Second editor', version: 1 })
	]);
	assert.deepEqual(edits.map(({ status }) => status).sort(), [200, 409]);
	snapshot = await loadSnapshot(db);
	assert.equal(snapshot.conversations[0].version, 18);
	assert.equal(snapshot.messages.find(({ id }) => id === target.id).version, 2);
	assert.equal((await api('DELETE', `conversations/${room.id}`, { version: 17 })).status, 409);
	assert.equal((await loadSnapshot(db)).messages.length, 16);
	assert.equal((await api('DELETE', `conversations/${room.id}`, { version: 18 })).status, 200);
	assert.deepEqual(await loadSnapshot(db), {
		folders: [],
		vocabulary: [],
		conversations: [],
		messages: []
	});
});

test('local D1 moves touch both parents once and rolls back trigger effects on batch failure', async (t) => {
	const { db, api } = await setup(t);
	const source = (await api('POST', 'conversations', { title: 'Source' })).body.item;
	const destination = (await api('POST', 'conversations', { title: 'Destination' })).body.item;
	const item = (
		await api('POST', 'messages', {
			conversation_id: source.id,
			speaker: 'me',
			content: 'Keep me'
		})
	).body.item;
	assert.equal(
		(
			await api('PATCH', `messages/${item.id}`, {
				conversation_id: 'missing',
				content: 'Must not change',
				version: 1
			})
		).status,
		404
	);
	let snapshot = await loadSnapshot(db);
	assert.equal(snapshot.messages[0].content, 'Keep me');
	assert.deepEqual(
		snapshot.conversations.map(({ version }) => version),
		[2, 1]
	);
	assert.equal(
		(
			await api('PATCH', `messages/${item.id}`, {
				conversation_id: destination.id,
				version: 1
			})
		).status,
		200
	);
	snapshot = await loadSnapshot(db);
	assert.deepEqual(
		snapshot.conversations.map(({ version, message_count }) => [version, message_count]),
		[
			[3, 0],
			[2, 1]
		]
	);
	assert.equal(
		(
			await api('PATCH', `messages/${item.id}`, {
				conversation_id: destination.id,
				content: 'Same room',
				version: 2
			})
		).status,
		200
	);
	snapshot = await loadSnapshot(db);
	assert.deepEqual(
		snapshot.conversations.map(({ version }) => version),
		[3, 3]
	);
	const beforeFailure = snapshot;
	await assert.rejects(
		db.batch([
			db
				.prepare('UPDATE messages SET content = ?, version = version + 1 WHERE id = ?')
				.bind('Rolled back', item.id),
			db
				.prepare(
					'INSERT INTO messages (id, conversation_id, speaker, content, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
				)
				.bind(crypto.randomUUID(), 'no-parent', 'me', 'Invalid', 0, Date.now(), Date.now())
		])
	);
	assert.deepEqual(await loadSnapshot(db), beforeFailure);
	const changed = await db
		.prepare('UPDATE messages SET content = ? WHERE id = ?')
		.bind('Trigger counted', item.id)
		.run();
	assert.equal(changed.meta.changes, 2);
});

test('local D1 races parent deletion against child creation without orphaning or silently deleting newer children', async (t) => {
	const { db, api } = await setup(t);
	for (let attempt = 0; attempt < 6; attempt++) {
		const folder = (await api('POST', 'folders', { name: `Race ${attempt}` })).body.item;
		const [child, deletion] = await Promise.all([
			api('POST', 'vocabulary', { folder_id: folder.id, word: 'Race', meaning: '競合' }),
			api('DELETE', `folders/${folder.id}`, { version: folder.version })
		]);
		const snapshot = await loadSnapshot(db);
		if (child.status === 201) {
			assert.equal(deletion.status, 409);
			assert.equal(snapshot.folders.find(({ id }) => id === folder.id).word_count, 1);
			assert.ok(snapshot.vocabulary.some(({ id }) => id === child.body.item.id));
		} else {
			assert.equal(child.status, 404);
			assert.equal(deletion.status, 200);
			assert.ok(!snapshot.folders.some(({ id }) => id === folder.id));
			assert.ok(!snapshot.vocabulary.some(({ folder_id }) => folder_id === folder.id));
		}
	}
});
