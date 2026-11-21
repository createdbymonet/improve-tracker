import { RequestError } from './http.ts';

export const COOKIE_NAME = '__Host-improve-session';
export const IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 180 * 24 * 60 * 60 * 1000;
export const ROTATE_MS = 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 2 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;

interface Session {
	id: string;
	token_hash: string;
	credential_fingerprint: string;
	previous_token_hash: string | null;
	previous_valid_until: number | null;
	created_at: number;
	last_seen_at: number;
	idle_expires_at: number;
	absolute_expires_at: number;
	rotated_at: number;
}

export async function hashToken(value: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function equalHashes(a: string, b: string) {
	if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
	const key = await crypto.subtle.importKey(
		'raw',
		crypto.getRandomValues(new Uint8Array(32)),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(a));
	return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(b));
}

function randomToken() {
	return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

export function isConfigured(hash: string | undefined): hash is string {
	return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
}

export async function consumeLoginAttempt(
	db: D1Database,
	ownerHash: string,
	ip: string,
	now = Date.now()
) {
	await db.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').bind(now).run();
	// Keyed buckets resist recovering IPs from a leaked database. IP is not an auth condition.
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(ownerHash),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
	const ipBucket = Array.from(new Uint8Array(signature), (b) =>
		b.toString(16).padStart(2, '0')
	).join('');
	// Both per-source and global limits are atomic, including across Worker instances.
	for (const [bucket, maximum] of [
		['global', 30],
		[ipBucket, 5]
	] as const) {
		const row = await db
			.prepare(
				`INSERT INTO login_attempts(bucket, attempts, reset_at) VALUES (?, 1, ?)
			ON CONFLICT(bucket) DO UPDATE SET
			attempts = CASE WHEN reset_at <= ? THEN 1 ELSE attempts + 1 END,
			reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
			RETURNING attempts, reset_at`
			)
			.bind(bucket, now + RATE_WINDOW_MS, now, now)
			.first<{ attempts: number; reset_at: number }>();
		if (!row || row.attempts > maximum)
			throw new RequestError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
	}
}

export async function createSession(db: D1Database, ownerHash: string, now = Date.now()) {
	const id = crypto.randomUUID();
	const secret = randomToken();
	await db.batch([
		db
			.prepare('DELETE FROM sessions WHERE idle_expires_at <= ? OR absolute_expires_at <= ?')
			.bind(now, now),
		db.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').bind(now),
		db
			.prepare(
				`INSERT INTO sessions(id, token_hash, credential_fingerprint, created_at, last_seen_at,
			idle_expires_at, absolute_expires_at, rotated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				id,
				await hashToken(secret),
				await hashToken(ownerHash),
				now,
				now,
				now + IDLE_MS,
				now + ABSOLUTE_MS,
				now
			)
	]);
	return { id, cookie: id + '.' + secret, maxAge: ABSOLUTE_MS / 1000 };
}

export async function authenticate(
	db: D1Database,
	cookie: string | undefined,
	ownerHash: string,
	now = Date.now()
): Promise<{ id: string; cookie: string | null; maxAge: number } | null> {
	if (!cookie || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(cookie)) return null;
	const [id, secret] = cookie.split('.');
	const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
	if (!session || now >= session.idle_expires_at || now >= session.absolute_expires_at) return null;
	if (!(await equalHashes(await hashToken(ownerHash), session.credential_fingerprint))) return null;
	const digest = await hashToken(secret);
	const current = await equalHashes(digest, session.token_hash);
	const previous =
		session.previous_token_hash !== null &&
		session.previous_valid_until !== null &&
		now < session.previous_valid_until &&
		(await equalHashes(digest, session.previous_token_hash));
	if (!current && !previous) return null;
	// A concurrent request can use the previous token briefly, but cannot roll the cookie back.
	if (previous) return { id, cookie: null, maxAge: 0 };
	const expiry = Math.min(now + IDLE_MS, session.absolute_expires_at);
	if (now - session.rotated_at >= ROTATE_MS) {
		const next = randomToken();
		const result = await db
			.prepare(
				`UPDATE sessions SET previous_token_hash = token_hash,
			previous_valid_until = ?, token_hash = ?, rotated_at = ?, last_seen_at = ?, idle_expires_at = ?
			WHERE id = ? AND token_hash = ?`
			)
			.bind(now + ROTATION_GRACE_MS, await hashToken(next), now, now, expiry, id, digest)
			.run();
		if (!result.meta.changes) return authenticate(db, cookie, ownerHash, now);
		return {
			id,
			cookie: id + '.' + next,
			maxAge: Math.floor((session.absolute_expires_at - now) / 1000)
		};
	}
	const result = await db
		.prepare(
			`UPDATE sessions SET last_seen_at = MAX(last_seen_at, ?),
		idle_expires_at = MAX(idle_expires_at, ?) WHERE id = ? AND token_hash = ?`
		)
		.bind(now, expiry, id, digest)
		.run();
	if (!result.meta.changes) return authenticate(db, cookie, ownerHash, now);
	// Do not reset an old cookie on ordinary responses: a delayed response could undo a rotation.
	return { id, cookie: null, maxAge: 0 };
}

export async function revokeSession(db: D1Database, id: string) {
	await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}
