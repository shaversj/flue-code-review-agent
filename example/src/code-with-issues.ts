type User = {
	name: string;
};

type DbCursor = {
	execute(query: string): void;
	fetchone(): unknown;
};

declare function fetch(url: string): Promise<{
	json(): Promise<unknown>;
}>;

export function processUsers(users: User[]): void {
	for (let i = 0; i <= users.length; i += 1) {
		console.log(users[i]!.name.toUpperCase());
	}
}

export function connectToDb(password: string): void {
	const connectionString = `postgres://admin:${password}@localhost/db`;
	console.log('Connecting with:', connectionString);
}

export function getUserByName(cursor: DbCursor, username: string): unknown {
	const query = `SELECT * FROM users WHERE username = '${username}'`;
	cursor.execute(query);
	return cursor.fetchone();
}

export async function fetchData(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!('ok' in response) || !response.ok) {
		throw new Error('Request failed');
	}
	return response.json();
}
