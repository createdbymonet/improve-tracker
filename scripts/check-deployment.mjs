import { readFileSync } from 'node:fs';
import ts from 'typescript';

export function validateDeploymentConfig(source) {
	const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', source);
	if (error) throw new Error('Unable to parse the production Wrangler configuration.');
	const databases = Array.isArray(config?.d1_databases)
		? config.d1_databases.filter((database) => database?.binding === 'DB')
		: [];
	const databaseId = databases[0]?.database_id;
	if (
		databases.length !== 1 ||
		typeof databaseId !== 'string' ||
		!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(databaseId) ||
		databaseId === '00000000-0000-0000-0000-000000000000'
	) {
		throw new Error('Configure one DB binding with your existing D1 database ID before deploying.');
	}
	if (
		!Array.isArray(config.secrets?.required) ||
		!config.secrets.required.includes('OWNER_KEY_HASH')
	) {
		throw new Error('Declare OWNER_KEY_HASH in secrets.required before deploying.');
	}
	if (Object.hasOwn(config.vars ?? {}, 'OWNER_KEY_HASH')) {
		throw new Error('OWNER_KEY_HASH must be a Cloudflare secret, not a plaintext vars binding.');
	}
}

validateDeploymentConfig(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
