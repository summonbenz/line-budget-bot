import { getAuthHeaders } from './liff';
import type {
	AccountsResponse,
	BudgetResponse,
	CashflowResponse,
	CategoriesResponse,
	NewTransaction,
	ReflectResponse,
	TransactionsResponse,
	TxEntry,
	TxEntryUpdate
} from './types';

export class UnauthorizedError extends Error {
	constructor() {
		super('unauthorized');
		this.name = 'UnauthorizedError';
	}
}

async function apiFetch<T>(
	path: string,
	options: { method?: string; body?: unknown } = {}
): Promise<T> {
	const res = await fetch(path, {
		method: options.method ?? 'GET',
		headers: {
			...getAuthHeaders(),
			...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {})
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined
	});

	if (res.status === 401 || res.status === 403) {
		throw new UnauthorizedError();
	}
	if (!res.ok) {
		throw new Error(`request failed: ${res.status}`);
	}

	return res.json() as Promise<T>;
}

export function getBudget(month: string): Promise<BudgetResponse> {
	return apiFetch<BudgetResponse>(`/api/budget?month=${month}`);
}

export function setBudget(month: string, categoryId: string, amount: number): Promise<void> {
	return apiFetch<void>('/api/budget', { method: 'PUT', body: { month, categoryId, amount } });
}

export function getAccounts(): Promise<AccountsResponse> {
	return apiFetch<AccountsResponse>('/api/accounts');
}

export function getTransactions(limit = 200): Promise<TransactionsResponse> {
	return apiFetch<TransactionsResponse>(`/api/transactions?limit=${limit}`);
}

export function addTransaction(tx: NewTransaction): Promise<void> {
	return apiFetch<void>('/api/transactions', { method: 'POST', body: tx });
}

/** ตั้ง/แก้วงเงิน + วันครบกำหนดชำระของบัตร — creditLimit หน่วยบาท (ฝั่ง bot เก็บบาทลง SQLite ตรงๆ) */
export function setCardLimit(
	accountId: string,
	creditLimit: number,
	dueDay: number | null = null
): Promise<void> {
	return apiFetch<void>(`/api/cards/${accountId}`, {
		method: 'PUT',
		body: { creditLimit, dueDay }
	});
}

export function getCategories(): Promise<CategoriesResponse> {
	return apiFetch<CategoriesResponse>('/api/categories');
}

export function getReflect(months = 6): Promise<ReflectResponse> {
	return apiFetch<ReflectResponse>(`/api/reflect?months=${months}`);
}

/** หนี้บัตรรวม ณ สิ้นเดือนย้อนหลัง N เดือน (ฝั่ง bot จำกัดสูงสุด 24) */
export function getCashflow(months = 6): Promise<CashflowResponse> {
	return apiFetch<CashflowResponse>(`/api/cashflow?months=${months}`);
}

/**
 * รายการเดียวสำหรับหน้าแก้ไข /edit/{id} — id รับได้ทั้ง entry id (จากปุ่มในแชท)
 * และ id ธุรกรรมฝั่ง Actual (จากแท็บรายการ — ฝั่ง bot จะสร้าง entry ให้อัตโนมัติ)
 * accountId ใส่มาด้วยถ้ารู้ เพื่อให้ฝั่ง bot ไม่ต้องไล่หาทุกบัญชี
 * ค่า id ใน response คือ entry id เสมอ — ใช้ค่านั้นสำหรับ update/delete/slip ต่อ
 */
export function getTxEntry(id: string, accountId?: string): Promise<TxEntry> {
	const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
	return apiFetch<TxEntry>(`/api/tx/${id}${qs}`);
}

export function updateTxEntry(id: string, body: TxEntryUpdate): Promise<void> {
	return apiFetch<void>(`/api/tx/${id}`, { method: 'PUT', body });
}

export function deleteTxEntry(id: string): Promise<void> {
	return apiFetch<void>(`/api/tx/${id}`, { method: 'DELETE' });
}

/** รูปสลิปหลักฐาน — ต้อง fetch เองเพราะ <img> ใส่ Authorization header ไม่ได้ คืน object URL (หรือ null ถ้าไม่มี) */
export async function getTxSlipUrl(id: string): Promise<string | null> {
	const res = await fetch(`/api/tx/${id}/slip`, { headers: getAuthHeaders() });
	if (res.status === 401 || res.status === 403) throw new UnauthorizedError();
	if (!res.ok) return null;
	return URL.createObjectURL(await res.blob());
}
