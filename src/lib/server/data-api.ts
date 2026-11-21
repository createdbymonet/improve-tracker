import { CONVERSATION_SELECT, FOLDER_SELECT, loadSnapshot } from './db.ts';

type Collection = 'folders' | 'vocabulary' | 'conversations' | 'messages';
type Values = Record<string, string | number>;

interface Field {
	name: string;
	max: number;
	required?: boolean;
}

const definitions: Record<Collection, { fields: Field[]; parent?: [string, Collection] }> = {
	folders: { fields: [{ name: 'name', max: 120, required: true }] },
	vocabulary: {
		fields: [
			{ name: 'folder_id', max: 100, required: true },
			{ name: 'word', max: 200, required: true },
			{ name: 'example', max: 10000 },
			{ name: 'meaning', max: 2000, required: true },
			{ name: 'translation', max: 10000 },
			{ name: 'notes', max: 10000 }
		],
		parent: ['folder_id', 'folders']
	},
	conversations: {
		fields: [
			{ name: 'title', max: 120, required: true },
			{ name: 'description', max: 2000 }
		]
	},
	messages: {
		fields: [
			{ name: 'conversation_id', max: 100, required: true },
			{ name: 'speaker', max: 7, required: true },
			{ name: 'content', max: 10000, required: true }
		],
		parent: ['conversation_id', 'conversations']
	}
};

export class DataApiError extends Error {
	status: number;
	code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

function fail(status: number, code: string, message: string): never {
	throw new DataApiError(status, code, message);
}

function json(value: unknown, status = 200): Response {
	return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isCollection(value: string): value is Collection {
	return Object.hasOwn(definitions, value);
}

function selectItem(collection: Collection): string {
	if (collection === 'folders') return `${FOLDER_SELECT} WHERE f.id = ?`;
	if (collection === 'conversations') return `${CONVERSATION_SELECT} WHERE c.id = ?`;
	return `SELECT * FROM ${collection} WHERE id = ?`;
}

async function readBody(request: Request): Promise<unknown> {
	const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
	if (contentType !== 'application/json') {
		fail(415, 'invalid_content_type', 'Send this request as JSON.');
	}
	// Bound actual streamed bytes rather than trusting Content-Length.
	const reader = request.body?.getReader();
	if (!reader) fail(400, 'invalid_json', 'A JSON object is required.');
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > 128 * 1024) {
				await reader.cancel();
				fail(413, 'body_too_large', 'The request is too large.');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		return fail(400, 'invalid_json', 'The request contains invalid JSON.');
	}
}

export function validateDataInput(
	collection: Collection,
	method: 'POST' | 'PATCH' | 'DELETE',
	input: unknown
): Values {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		fail(400, 'invalid_input', 'A JSON object is required.');
	}
	const record = input as Record<string, unknown>;
	const fields = method === 'DELETE' ? [] : definitions[collection].fields;
	const allowed = new Set(fields.map(({ name }) => name));
	if (method !== 'POST') allowed.add('version');
	if (Object.keys(record).some((name) => !allowed.has(name))) {
		fail(400, 'invalid_input', 'The request contains an unsupported field.');
	}
	const values: Values = {};
	for (const field of fields) {
		if (method === 'PATCH' && !Object.hasOwn(record, field.name)) continue;
		const raw = Object.hasOwn(record, field.name)
			? record[field.name]
			: field.required
				? undefined
				: '';
		if (typeof raw !== 'string') {
			fail(400, 'invalid_input', `${field.name} must be text.`);
		}
		const value = raw.trim();
		if ((field.required && !value) || value.length > field.max) {
			fail(
				400,
				'invalid_input',
				`${field.name} must contain ${field.required ? '1' : '0'}–${field.max} characters.`
			);
		}
		if (field.name === 'speaker' && value !== 'me' && value !== 'partner') {
			fail(400, 'invalid_input', 'speaker must be me or partner.');
		}
		values[field.name] = value;
	}
	if (method !== 'POST') {
		const version = record.version;
		if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
			fail(400, 'invalid_version', 'A positive integer version is required.');
		}
		values.version = version;
	}
	if (method === 'PATCH' && Object.keys(values).length === 1) {
		fail(400, 'invalid_input', 'Provide at least one field to update.');
	}
	return values;
}

async function createItem(
	db: D1Database,
	collection: Collection,
	values: Values
): Promise<Response> {
	const id = crypto.randomUUID();
	const now = Date.now();
	const names = Object.keys(values);
	const parent = definitions[collection].parent;
	const orderWhere = parent ? ` WHERE ${parent[0]} = ?` : '';
	const orderBindings = parent ? [values[parent[0]]] : [];
	const exists = parent ? ` WHERE EXISTS (SELECT 1 FROM ${parent[1]} WHERE id = ?)` : '';
	const statements = [
		db
			.prepare(
				`INSERT INTO ${collection}
			(id, ${names.join(', ')}, sort_order, created_at, updated_at, version)
			SELECT ?, ${names.map(() => '?').join(', ')},
			(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ${collection}${orderWhere}), ?, ?, 1${exists}`
			)
			.bind(
				id,
				...Object.values(values),
				...orderBindings,
				now,
				now,
				...(parent ? [values[parent[0]]] : [])
			),
		db.prepare(selectItem(collection)).bind(id)
	];
	const [write, item] = await db.batch(statements);
	if (!write.meta.changes) fail(404, 'not_found', 'The destination no longer exists.');
	return json({ item: item.results[0] }, 201);
}

async function changeItem(
	db: D1Database,
	collection: Collection,
	id: string,
	method: 'PATCH' | 'DELETE',
	values: Values
): Promise<Response> {
	const parent = definitions[collection].parent;
	const parentValue = parent && values[parent[0]];
	const hasParent = Boolean(parent && parentValue !== undefined);
	const parentCondition = hasParent ? ` AND EXISTS (SELECT 1 FROM ${parent![1]} WHERE id = ?)` : '';
	let mutation: D1PreparedStatement;
	if (method === 'DELETE') {
		mutation = db
			.prepare(`DELETE FROM ${collection} WHERE id = ? AND version = ?`)
			.bind(id, values.version);
	} else {
		const entries = Object.entries(values).filter(([name]) => name !== 'version');
		const set = entries.map(([name]) => `${name} = ?`);
		const bindings: (string | number)[] = entries.map(([, value]) => value);
		if (hasParent) {
			set.push(`sort_order = CASE WHEN ${parent![0]} <> ? THEN
				(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ${collection} WHERE ${parent![0]} = ?)
				ELSE sort_order END`);
			bindings.push(parentValue!, parentValue!);
		}
		set.push('updated_at = MAX(updated_at, ?)', 'version = version + 1');
		bindings.push(Date.now(), id, values.version);
		if (hasParent) bindings.push(parentValue!);
		mutation = db
			.prepare(
				`UPDATE ${collection} SET ${set.join(', ')}
			WHERE id = ? AND version = ?${parentCondition}`
			)
			.bind(...bindings);
	}
	const statements = [
		db.prepare(`SELECT id, version FROM ${collection} WHERE id = ?`).bind(id),
		...(hasParent
			? [db.prepare(`SELECT id FROM ${parent![1]} WHERE id = ?`).bind(parentValue!)]
			: []),
		mutation,
		db.prepare(selectItem(collection)).bind(id)
	];
	const results = await db.batch(statements);
	if (!results[0].results.length) fail(404, 'not_found', 'This item no longer exists.');
	if (hasParent && !results[1].results.length)
		fail(404, 'not_found', 'The destination no longer exists.');
	if (!results[results.length - 2].meta.changes) {
		fail(409, 'conflict', 'This item changed in another session. Refresh and try again.');
	}
	return method === 'DELETE'
		? json({ deleted: true })
		: json({ item: results[results.length - 1].results[0] });
}

export async function handleDataRequest(
	db: D1Database,
	request: Request,
	path: string,
	isOwner: boolean
): Promise<Response> {
	try {
		const method = request.method;
		if (method !== 'GET' && !isOwner) fail(403, 'forbidden', 'Owner sign-in is required.');
		const segments = path.split('/').filter(Boolean);
		if (method === 'GET') {
			if (segments.length) fail(404, 'not_found', 'This endpoint does not exist.');
			return json(await loadSnapshot(db));
		}
		if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
			fail(405, 'method_not_allowed', 'This method is not supported.');
		}
		const [collection, id] = segments;
		if (
			!collection ||
			!isCollection(collection) ||
			segments.length > 2 ||
			(method === 'POST' ? Boolean(id) : !id)
		) {
			fail(404, 'not_found', 'This endpoint does not exist.');
		}
		if (id && (id.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(id))) {
			fail(400, 'invalid_id', 'This item ID is invalid.');
		}
		const values = validateDataInput(collection, method, await readBody(request));
		return method === 'POST'
			? await createItem(db, collection, values)
			: await changeItem(db, collection, id!, method, values);
	} catch (error) {
		if (error instanceof DataApiError)
			return json({ error: error.message, code: error.code }, error.status);
		console.error(JSON.stringify({ event: 'data_api_failed', method: request.method }));
		return json(
			{ error: 'The notebook could not be saved or loaded. Try again.', code: 'database_error' },
			503
		);
	}
}
