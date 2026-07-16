import { getAuthHeaders } from './liff';
import type { SummaryResponse, TransactionsResponse, CashflowResponse } from './types';

export class UnauthorizedError extends Error {
	constructor() {
		super('unauthorized');
		this.name = 'UnauthorizedError';
	}
}

async function apiFetch<T>(path: string): Promise<T> {
	const res = await fetch(path, { headers: getAuthHeaders() });

	if (res.status === 401 || res.status === 403) {
		throw new UnauthorizedError();
	}
	if (!res.ok) {
		throw new Error(`request failed: ${res.status}`);
	}

	return res.json() as Promise<T>;
}

export function getSummary(month: string): Promise<SummaryResponse> {
	return apiFetch<SummaryResponse>(`/api/summary?month=${month}`);
}

export function getTransactions(): Promise<TransactionsResponse> {
	return apiFetch<TransactionsResponse>('/api/transactions');
}

export function getCashflow(): Promise<CashflowResponse> {
	return apiFetch<CashflowResponse>('/api/cashflow');
}
