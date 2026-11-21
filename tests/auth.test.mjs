import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase } from './helpers/d1.mjs';
import {
	authenticate,
	createSession,
	revokeSession,
	consumeLoginAttempt,
	hashToken,
	equalHashes,
	IDLE_MS,
	ABSOLUTE_MS,
	ROTATE_MS
} from '../src/lib/server/auth.ts';
import { assertSameOrigin, assertOwner, readJson, errorResponse } from '../src/lib/server/http.ts';

const ownerHash = 'c'.repeat(64);

function database() {
	return createTestDatabase(['0001_initial.sql', '0002_auth.sql']);
}

test('persistent sessions contain only a hash and cannot be forged', async () => {
	const fixture = database();
	try {
		const now = 100000;
		const session = await createSession(fixture.db, ownerHash, now);
		assert.equal(session.maxAge, ABSOLUTE_MS / 1000);
		const row = fixture.sqlite.prepare('SELECT * FROM sessions').get();
		assert.equal(row.token_hash, await hashToken(session.cookie.split('.')[1]));
		assert.ok(!JSON.stringify(row).includes(session.cookie.split('.')[1]));
		assert.ok(await authenticate(fixture.db, session.cookie, ownerHash, now + 1));
		assert.equal(
			await authenticate(fixture.db, session.id + '.' + 'a'.repeat(43), ownerHash, now + 2),
			null
		);
		assert.equal(await authenticate(fixture.db, 'invalid', ownerHash, now), null);
		assert.equal(await equalHashes(await hashToken('a'), await hashToken('a')), true);
		assert.equal(await equalHashes(await hashToken('a'), await hashToken('b')), false);
	} finally {
		fixture.close();
	}
});

test('30 day idle expiry slides, 180 day absolute expiry does not', async () => {
	const fixture = database();
	try {
		const start = 100000;
		const session = await createSession(fixture.db, ownerHash, start);
		let cookie = session.cookie;
		for (let day = 20; day <= 160; day += 20) {
			const result = await authenticate(fixture.db, cookie, ownerHash, start + day * 86400000);
			assert.ok(result);
			cookie = result.cookie ?? cookie;
		}
		assert.equal(await authenticate(fixture.db, cookie, ownerHash, start + ABSOLUTE_MS), null);
		const idle = await createSession(fixture.db, ownerHash, start);
		assert.equal(await authenticate(fixture.db, idle.cookie, ownerHash, start + IDLE_MS), null);
	} finally {
		fixture.close();
	}
});

test('rotation has a short concurrency grace period and logout revokes server-side', async () => {
	const fixture = database();
	try {
		const start = 100000;
		const session = await createSession(fixture.db, ownerHash, start);
		const rotated = await authenticate(fixture.db, session.cookie, ownerHash, start + ROTATE_MS);
		assert.ok(rotated.cookie && rotated.cookie !== session.cookie);
		const parallel = await authenticate(
			fixture.db,
			session.cookie,
			ownerHash,
			start + ROTATE_MS + 1
		);
		assert.ok(parallel);
		assert.equal(parallel.cookie, null);
		assert.equal(
			await authenticate(fixture.db, session.cookie, ownerHash, start + ROTATE_MS + 120000),
			null
		);
		assert.ok(
			await authenticate(fixture.db, rotated.cookie, ownerHash, start + ROTATE_MS + 120000)
		);
		await revokeSession(fixture.db, session.id);
		assert.equal(
			await authenticate(fixture.db, rotated.cookie, ownerHash, start + ROTATE_MS + 120001),
			null
		);
	} finally {
		fixture.close();
	}
});

test('ordinary activity extends server idle expiry without reissuing a stale cookie', async () => {
	const fixture = database();
	try {
		const start = 100000;
		const session = await createSession(fixture.db, ownerHash, start);
		const activityAt = start + ROTATE_MS - 1;
		const result = await authenticate(fixture.db, session.cookie, ownerHash, activityAt);
		assert.equal(result.id, session.id);
		assert.equal(result.cookie, null);
		assert.equal(result.maxAge, 0);
		const row = fixture.sqlite.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
		assert.equal(row.last_seen_at, activityAt);
		assert.equal(row.idle_expires_at, activityAt + IDLE_MS);
		assert.equal(row.absolute_expires_at, start + ABSOLUTE_MS);
		assert.equal(row.rotated_at, start);
		assert.equal(row.token_hash, await hashToken(session.cookie.split('.')[1]));
	} finally {
		fixture.close();
	}
});

test('parallel rotation requests replace the token once and never roll its cookie back', async () => {
	const fixture = database();
	try {
		const start = 100000;
		const session = await createSession(fixture.db, ownerHash, start);
		const rotationAt = start + ROTATE_MS;
		// Every request reads the old row before the asynchronous crypto checks complete.
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				authenticate(fixture.db, session.cookie, ownerHash, rotationAt)
			)
		);
		assert.ok(results.every((result) => result?.id === session.id));
		const changedCookies = results.filter((result) => result.cookie !== null);
		assert.equal(changedCookies.length, 1);
		const replacement = changedCookies[0];
		assert.notEqual(replacement.cookie, session.cookie);
		assert.equal(replacement.maxAge, (ABSOLUTE_MS - ROTATE_MS) / 1000);
		const row = fixture.sqlite.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
		assert.equal(row.token_hash, await hashToken(replacement.cookie.split('.')[1]));
		assert.equal(row.previous_token_hash, await hashToken(session.cookie.split('.')[1]));
		assert.equal(row.rotated_at, rotationAt);
		assert.equal(row.previous_valid_until, rotationAt + 120000);
		const current = await authenticate(fixture.db, replacement.cookie, ownerHash, rotationAt + 1);
		assert.equal(current.cookie, null);
		assert.equal(
			await authenticate(fixture.db, session.cookie, ownerHash, rotationAt + 120000),
			null
		);
	} finally {
		fixture.close();
	}
});

test('changing the owner credential invalidates current and grace-period tokens', async () => {
	const fixture = database();
	try {
		const start = 100000;
		const session = await createSession(fixture.db, ownerHash, start);
		const rotated = await authenticate(fixture.db, session.cookie, ownerHash, start + ROTATE_MS);
		const replacementOwnerHash = await hashToken('replacement-owner-credential');
		for (const cookie of [session.cookie, rotated.cookie]) {
			assert.equal(
				await authenticate(fixture.db, cookie, replacementOwnerHash, start + ROTATE_MS + 1),
				null
			);
		}
		const row = fixture.sqlite.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
		assert.equal(row.credential_fingerprint, await hashToken(ownerHash));
		assert.ok(!Object.values(row).includes(ownerHash));
	} finally {
		fixture.close();
	}
});

test('devices have independent sessions; rate limit resets and includes global limit', async () => {
	const fixture = database();
	try {
		const first = await createSession(fixture.db, ownerHash, 1000);
		const second = await createSession(fixture.db, ownerHash, 1000);
		await revokeSession(fixture.db, first.id);
		assert.ok(await authenticate(fixture.db, second.cookie, ownerHash, 1001));
		const hash = await hashToken('random-test-owner');
		for (let i = 0; i < 5; i++) await consumeLoginAttempt(fixture.db, hash, 'test-source', 1000);
		await assert.rejects(
			consumeLoginAttempt(fixture.db, hash, 'test-source', 1001),
			(e) => e.status === 429
		);
		await consumeLoginAttempt(fixture.db, hash, 'test-source', 901001);
		for (let i = 0; i < 29; i++) await consumeLoginAttempt(fixture.db, hash, 'source-' + i, 901001);
		await assert.rejects(
			consumeLoginAttempt(fixture.db, hash, 'another-source', 901001),
			(e) => e.status === 429
		);
		assert.ok(
			!JSON.stringify(fixture.sqlite.prepare('SELECT * FROM login_attempts').all()).includes(
				'test-source'
			)
		);
	} finally {
		fixture.close();
	}
});

test('login attempts collect expired buckets even when the global limit rejects a new source', async () => {
	const fixture = database();
	try {
		const now = 100000;
		fixture.sqlite
			.prepare('INSERT INTO login_attempts(bucket, attempts, reset_at) VALUES (?, ?, ?)')
			.run('expired-before-login', 1, now);
		for (let i = 0; i < 30; i++) {
			await consumeLoginAttempt(fixture.db, ownerHash, 'source-' + i, now);
		}
		assert.equal(
			fixture.sqlite
				.prepare('SELECT * FROM login_attempts WHERE bucket = ?')
				.get('expired-before-login'),
			undefined
		);
		const bucketCount = fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n;
		assert.equal(bucketCount, 31);
		fixture.sqlite
			.prepare('INSERT INTO login_attempts(bucket, attempts, reset_at) VALUES (?, ?, ?)')
			.run('expired-while-blocked', 1, now);
		for (let i = 30; i < 40; i++) {
			await assert.rejects(
				consumeLoginAttempt(fixture.db, ownerHash, 'source-' + i, now),
				(error) => error.status === 429
			);
		}
		assert.equal(
			fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,
			bucketCount
		);
		assert.equal(
			fixture.sqlite.prepare('SELECT attempts FROM login_attempts WHERE bucket = ?').get('global')
				.attempts,
			40
		);
	} finally {
		fixture.close();
	}
});

test('CSRF, JSON validation, authorization and sanitized errors', async () => {
	const request = (origin, body = '{}', type = 'application/json') =>
		new Request('https://notebook.test/api/auth/login', {
			method: 'POST',
			headers: { ...(origin ? { origin } : {}), 'content-type': type },
			body
		});
	assert.doesNotThrow(() => assertSameOrigin(request('https://notebook.test')));
	assert.throws(
		() => assertSameOrigin(request('https://other.test')),
		(e) => e.status === 403
	);
	assert.throws(
		() => assertSameOrigin(request(null)),
		(e) => e.status === 403
	);
	assert.throws(
		() => assertOwner({ isOwner: false }),
		(e) => e.status === 401
	);
	assert.deepEqual(await readJson(request('https://notebook.test')), {});
	await assert.rejects(readJson(request('https://notebook.test', '[]')), (e) => e.status === 400);
	await assert.rejects(readJson(request('https://notebook.test', '{bad')), (e) => e.status === 400);
	await assert.rejects(
		readJson(request('https://notebook.test', '{}', 'text/plain')),
		(e) => e.status === 415
	);
	await assert.rejects(
		readJson(request('https://notebook.test', JSON.stringify({ key: 'x'.repeat(200000) }))),
		(e) => e.status === 413
	);
	assert.ok(!(await errorResponse(new Error('private database secret')).text()).includes('secret'));
});
