import type { RequestHandler } from './$types';
import { getEnvironment } from '../../../../lib/server/environment.ts';
import { COOKIE_NAME, revokeSession } from '../../../../lib/server/auth.ts';
import {
	assertOwner,
	assertSameOrigin,
	errorResponse,
	RequestError
} from '../../../../lib/server/http.ts';

export const POST: RequestHandler = async ({ request, platform, locals, cookies }) => {
	try {
		assertSameOrigin(request);
		assertOwner(locals);
		const env = await getEnvironment(platform);
		if (!env.DB || !locals.sessionId) throw new RequestError(503, 'Unable to sign out. Try again.');
		await revokeSession(env.DB, locals.sessionId);
		cookies.delete(COOKIE_NAME, { path: '/' });
		return Response.json({ ok: true });
	} catch (error) {
		return errorResponse(error);
	}
};
