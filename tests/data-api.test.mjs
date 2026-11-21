import assert from 'node:assert/strict';
import test from 'node:test';
import { handleDataRequest } from '../src/lib/server/data-api.ts';
import { loadSnapshot } from '../src/lib/server/db.ts';
import { createTestDatabase } from './helpers/d1.mjs';

const word = (folder_id, overrides = {}) => ({
	folder_id,
	word: '  Improve  ',
	meaning: ' 上達する ',
	example: '',
	translation: '',
	notes: '',
	...overrides
});

function client(db, isOwner = true) {
	return async (method, path = '', data) => {
		const request = new Request(`https://notebook.example/api/data/${path}`, {
			method,
			headers: data === undefined ? {} : { 'content-type': 'application/json' },
			...(data === undefined ? {} : { body: JSON.stringify(data) })
		});
		const response = await handleDataRequest(db, request, path, isOwner);
		return { status: response.status, body: await response.json(), response };
	};
}

test('fresh D1 has no seeded/private browser data, and guests cannot mutate any collection', async (t) => {
	const database = createTestDatabase();
	t.after(database.close);
	const guest = client(database.db, false);
	const empty = await guest('GET');
	assert.deepEqual(empty.body, { folders: [], vocabulary: [], conversations: [], messages: [] });
	assert.equal(empty.response.headers.get('cache-control'), 'no-store');
	for (const collection of ['folders', 'vocabulary', 'conversations', 'messages']) {
		for (const method of ['POST', 'PATCH', 'DELETE']) {
			const response = await guest(method, collection + (method === 'POST' ? '' : '/missing'), {});
			assert.equal(response.status, 403);
		}
	}
	assert.deepEqual(await loadSnapshot(database.db), empty.body);
});

test('folder/word CRUD persists across requests; stale versions cannot overwrite or delete', async (t) => {
	const database = createTestDatabase();
	t.after(database.close);
	const api = client(database.db);
	const folder = (await api('POST', 'folders', { name: ' Travel ' })).body.item;
	assert.equal(folder.name, 'Travel');
	assert.equal(folder.word_count, 0);
	assert.equal(folder.version, 1);
	const created = await api('POST', 'vocabulary', word(folder.id));
	assert.equal(created.status, 201);
	const item = created.body.item;
	assert.equal(item.word, 'Improve');
	assert.equal(item.meaning, '上達する');
	assert.equal(item.sort_order, 0);
	assert.equal(item.version, 1);
	assert.equal(typeof item.created_at, 'number');
	assert.equal((await api('DELETE', `folders/${folder.id}`, { version: 1 })).status, 409);
	const edit = await api('PATCH', `vocabulary/${item.id}`, {
		...word(folder.id),
		word: 'Better',
		version: 1
	});
	assert.equal(edit.status, 200);
	assert.equal(edit.body.item.version, 2);
	assert.equal(
		(await api('PATCH', `vocabulary/${item.id}`, { word: 'Stale', version: 1 })).status,
		409
	);
	assert.equal((await api('DELETE', `vocabulary/${item.id}`, { version: 1 })).status, 409);
	const snapshot = (await api('GET')).body;
	assert.equal(snapshot.vocabulary[0].word, 'Better');
	assert.equal(snapshot.folders[0].word_count, 1);
	assert.equal(snapshot.folders[0].version, 3);
	assert.equal((await api('DELETE', `vocabulary/${item.id}`, { version: 2 })).status, 200);
	assert.equal((await api('DELETE', `vocabulary/${item.id}`, { version: 2 })).status, 404);
	assert.equal((await api('GET')).body.folders[0].version, 4);
});

test('moving words appends to destination and invalidates both parent versions; deletion cascades', async (t) => {
	const database = createTestDatabase();
	t.after(database.close);
	const api = client(database.db);
	const left = (await api('POST', 'folders', { name: 'A' })).body.item;
	const right = (await api('POST', 'folders', { name: 'B' })).body.item;
	const first = (await api('POST', 'vocabulary', word(left.id))).body.item;
	await api('POST', 'vocabulary', word(right.id, { word: 'Existing' }));
	const moved = await api('PATCH', `vocabulary/${first.id}`, {
		folder_id: right.id,
		version: first.version
	});
	assert.equal(moved.status, 200);
	assert.equal(moved.body.item.sort_order, 1);
	let snapshot = await loadSnapshot(database.db);
	assert.deepEqual(
		snapshot.folders.map((f) => [f.word_count, f.version]),
		[
			[0, 3],
			[2, 3]
		]
	);
	assert.equal((await api('DELETE', `folders/${right.id}`, { version: 2 })).status, 409);
	assert.equal((await api('DELETE', `folders/${right.id}`, { version: 3 })).status, 200);
	snapshot = await loadSnapshot(database.db);
	assert.equal(snapshot.vocabulary.length, 0);
});

test('conversations/messages preserve server order, parent versions, edits, deletes and cascade', async (t) => {
	const database = createTestDatabase();
	t.after(database.close);
	const api = client(database.db);
	const room = (
		await api('POST', 'conversations', { title: ' Interview ', description: ' Practice ' })
	).body.item;
	assert.equal(room.title, 'Interview');
	assert.equal(room.description, 'Practice');
	const one = (
		await api('POST', 'messages', { conversation_id: room.id, speaker: 'me', content: ' Hello ' })
	).body.item;
	const two = (
		await api('POST', 'messages', { conversation_id: room.id, speaker: 'partner', content: 'Hi' })
	).body.item;
	assert.deepEqual([one.sort_order, two.sort_order], [0, 1]);
	assert.equal(one.content, 'Hello');
	assert.equal(
		(await api('PATCH', `messages/${one.id}`, { content: 'Good morning', version: 1 })).status,
		200
	);
	assert.equal(
		(await api('PATCH', `messages/${one.id}`, { content: 'Lost', version: 1 })).status,
		409
	);
	assert.equal((await api('DELETE', `conversations/${room.id}`, { version: 1 })).status, 409);
	assert.equal((await api('DELETE', `messages/${two.id}`, { version: 1 })).status, 200);
	const snapshot = await loadSnapshot(database.db);
	assert.equal(snapshot.conversations[0].message_count, 1);
	assert.equal(snapshot.conversations[0].version, 5);
	assert.equal((await api('DELETE', `conversations/${room.id}`, { version: 5 })).status, 200);
	assert.equal((await loadSnapshot(database.db)).messages.length, 0);
});

test('invalid values, unsupported fields, missing parents and unknown IDs cannot mutate data', async (t) => {
	const database = createTestDatabase();
	t.after(database.close);
	const api = client(database.db);
	const folder = (await api('POST', 'folders', { name: 'Safe' })).body.item;
	for (const payload of [
		{ name: '　' },
		{ name: 'x'.repeat(121) },
		{ name: 'OK', id: 'injected' },
		[],
		null
	]) {
		assert.equal((await api('POST', 'folders', payload)).status, 400);
	}
	for (const overrides of [
		{ word: ' ' },
		{ meaning: '' },
		{ example: 3 },
		{ notes: null },
		{ folder_id: null }
	]) {
		assert.equal((await api('POST', 'vocabulary', word(folder.id, overrides))).status, 400);
	}
	assert.equal((await api('POST', 'vocabulary', word('missing'))).status, 404);
	const item = (await api('POST', 'vocabulary', word(folder.id))).body.item;
	assert.equal(
		(await api('PATCH', `vocabulary/${item.id}`, { folder_id: 'missing', version: 1 })).status,
		404
	);
	assert.equal((await api('PATCH', `vocabulary/${item.id}`, { word: 'X' })).status, 400);
	assert.equal(
		(await api('PATCH', `vocabulary/${item.id}`, { word: 'X', version: '1' })).status,
		400
	);
	assert.equal((await api('PATCH', `vocabulary/${item.id}`, { version: 1 })).status, 400);
	assert.equal((await api('DELETE', 'folders/missing', { version: 1 })).status, 404);
	const snapshot = await loadSnapshot(database.db);
	assert.equal(snapshot.folders.length, 1);
	assert.equal(snapshot.vocabulary[0].word, 'Improve');
	assert.equal(snapshot.vocabulary[0].version, 1);
});

test('parameterized input stays text; message speaker and JSON body limits are enforced', async (t) => {
	const database = createTestDatabase();
	t.after(database.close);
	const api = client(database.db);
	const text = "' ); DROP TABLE folders; --";
	assert.equal((await api('POST', 'folders', { name: text })).body.item.name, text);
	const room = (await api('POST', 'conversations', { title: 'Room' })).body.item;
	assert.equal(
		(await api('POST', 'messages', { conversation_id: room.id, speaker: 'system', content: 'no' }))
			.status,
		400
	);
	const huge = new Request('https://notebook.example/api/data/folders', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: 'x'.repeat(128 * 1024 + 1)
	});
	assert.equal((await handleDataRequest(database.db, huge, 'folders', true)).status, 413);
	const malformed = new Request('https://notebook.example/api/data/folders', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{broken'
	});
	assert.equal((await handleDataRequest(database.db, malformed, 'folders', true)).status, 400);
	for (const contentType of ['text/plain', 'application/json-invalid']) {
		const invalidType = new Request('https://notebook.example/api/data/folders', {
			method: 'POST',
			headers: { 'content-type': contentType },
			body: '{"name":"Wrong type"}'
		});
		assert.equal((await handleDataRequest(database.db, invalidType, 'folders', true)).status, 415);
	}
	const parameterizedType = new Request('https://notebook.example/api/data/folders', {
		method: 'POST',
		headers: { 'content-type': 'application/json; charset=utf-8' },
		body: '{"name":"Correct type"}'
	});
	assert.equal(
		(await handleDataRequest(database.db, parameterizedType, 'folders', true)).status,
		201
	);
	assert.equal((await loadSnapshot(database.db)).folders.length, 2);
});
