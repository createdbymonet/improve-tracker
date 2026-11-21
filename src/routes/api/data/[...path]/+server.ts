import type { RequestHandler } from './$types';
import { handleDataRequest } from '../../../../lib/server/data-api.ts';
import { getEnvironment } from '../../../../lib/server/environment.ts';

const handle: RequestHandler = async ({ request, params, locals, platform }) => {
	if (request.method !== 'GET' && !locals.isOwner) {
		return Response.json(
			{ error: 'Owner sign-in is required.', code: 'forbidden' },
			{ status: 403 }
		);
	}
	const db = (await getEnvironment(platform)).DB;
	if (!db) {
		return Response.json(
			{ error: 'The database is not configured.', code: 'database_unavailable' },
			{ status: 503 }
		);
	}
	return handleDataRequest(db, request, params.path ?? '', locals.isOwner);
};

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
