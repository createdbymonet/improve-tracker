export async function mutate<T>(
	path: string,
	method: 'POST' | 'PATCH' | 'DELETE',
	body: unknown
): Promise<T> {
	const response = await fetch(path, {
		method,
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const result: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		if (response.status === 409)
			throw new Error(
				'This item changed in another tab or device. Refresh the notebook before trying again. Your input is still here.'
			);
		if ((response.status === 401 || response.status === 403) && !path.includes('/auth/login'))
			throw new Error(
				'Your session expired. Open Renew sign-in in a new tab, then retry saving. Your input is still here.'
			);
		const message =
			result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
				? result.error
				: 'Unable to save. Check your connection and try again.';
		throw new Error(message);
	}
	return result as T;
}
