import type { RequestHandler } from './$types';

// The hook checks/renews a valid owner session. Guest reads never write to D1.
export const GET: RequestHandler = ({ locals }) => Response.json({ isOwner: locals.isOwner });
