export class RequestError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export function assertOwner(locals: { isOwner: boolean }) {
	if (!locals.isOwner) throw new RequestError(401, 'Sign in to edit this notebook.');
}

export function assertSameOrigin(request: Request) {
	if (
		request.headers.get('origin') !== new URL(request.url).origin ||
		request.headers.get('sec-fetch-site') === 'cross-site'
	) {
		throw new RequestError(403, 'This request is not allowed. Refresh and try again.');
	}
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
		throw new RequestError(415, 'Send JSON data.');
	}
	const limit = 192 * 1024;
	const reader = request.body?.getReader();
	if (!reader) throw new RequestError(400, 'Request data is required.');
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > limit) {
				await reader.cancel();
				throw new RequestError(413, 'The request is too large.');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	try {
		const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
		return data as Record<string, unknown>;
	} catch {
		throw new RequestError(400, 'The request is not valid JSON data.');
	}
}

export function errorResponse(error: unknown) {
	return Response.json(
		{
			error:
				error instanceof RequestError ? error.message : 'Unable to complete the request. Try again.'
		},
		{ status: error instanceof RequestError ? error.status : 503 }
	);
}
