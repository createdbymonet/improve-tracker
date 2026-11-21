import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeploymentConfig } from '../scripts/check-deployment.mjs';

function configuration() {
	return {
		d1_databases: [{ binding: 'DB', database_id: '11111111-1111-4111-8111-111111111111' }],
		secrets: { required: ['OWNER_KEY_HASH'] }
	};
}

test('production config accepts an existing D1 binding and required secret names without values', () => {
	assert.doesNotThrow(() => validateDeploymentConfig(JSON.stringify(configuration())));
	assert.doesNotThrow(() =>
		validateDeploymentConfig('// JSONC comments are supported\n' + JSON.stringify(configuration()))
	);
});

test('production config rejects missing, duplicate, placeholder, and malformed DB bindings', () => {
	for (const databases of [
		undefined,
		[],
		[{ binding: 'OTHER', database_id: '11111111-1111-4111-8111-111111111111' }],
		[{ binding: 'DB', database_id: '00000000-0000-0000-0000-000000000000' }],
		[{ binding: 'DB', database_id: 'invalid' }],
		[...configuration().d1_databases, ...configuration().d1_databases]
	]) {
		assert.throws(
			() =>
				validateDeploymentConfig(JSON.stringify({ ...configuration(), d1_databases: databases })),
			/Configure one DB binding/
		);
	}
});

test('production config requires secret inheritance and rejects a plaintext owner hash', () => {
	for (const secrets of [undefined, {}, { required: [] }, { required: ['OTHER_SECRET'] }]) {
		assert.throws(
			() => validateDeploymentConfig(JSON.stringify({ ...configuration(), secrets })),
			/Declare OWNER_KEY_HASH/
		);
	}
	assert.throws(
		() =>
			validateDeploymentConfig(
				JSON.stringify({ ...configuration(), vars: { OWNER_KEY_HASH: 'test-only-value' } })
			),
		/Cloudflare secret/
	);
	assert.throws(() => validateDeploymentConfig('{'), /Unable to parse/);
});
