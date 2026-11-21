import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

function binding(value) {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (
		value === null ||
		typeof value === 'number' ||
		typeof value === 'string' ||
		value instanceof Uint8Array
	) {
		return value;
	}
	throw new TypeError('Unsupported D1 parameter type.');
}

class TestStatement {
	constructor(sqlite, sql, values = []) {
		this.sqlite = sqlite;
		this.sql = sql;
		this.values = values;
	}
	bind(...values) {
		return new TestStatement(this.sqlite, this.sql, values.map(binding));
	}
	execute() {
		const statement = this.sqlite.prepare(this.sql);
		// D1 reports total_changes(), including triggers/cascades, rather than changes().
		const before = this.sqlite.prepare('SELECT total_changes() AS n').get().n;
		let results = [];
		if (statement.columns().length) {
			results = statement.all(...this.values).map((row) => ({ ...row }));
		} else {
			statement.run(...this.values);
		}
		const changes = Number(this.sqlite.prepare('SELECT total_changes() AS n').get().n - before);
		return { success: true, results, meta: { changes } };
	}
	async all() {
		return this.execute();
	}
	async run() {
		return this.execute();
	}
	async first(column) {
		const row = this.execute().results[0];
		return row ? (column ? row[column] : row) : null;
	}
	async raw() {
		return this.execute().results.map(Object.values);
	}
}

export function createTestDatabase(schemaFiles = ['0001_initial.sql']) {
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const file of schemaFiles) {
		sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
	}
	const db = {
		prepare(sql) {
			return new TestStatement(sqlite, sql);
		},
		async batch(statements) {
			sqlite.exec('BEGIN');
			try {
				const results = statements.map((statement) => statement.execute());
				sqlite.exec('COMMIT');
				return results;
			} catch (error) {
				sqlite.exec('ROLLBACK');
				throw error;
			}
		},
		async exec(sql) {
			sqlite.exec(sql);
			return { count: 1, duration: 0 };
		}
	};
	return { db, sqlite, close: () => sqlite.close() };
}
