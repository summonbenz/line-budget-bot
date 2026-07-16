export interface Account {
	id: string;
	name: string;
	isCard: boolean;
	balance: number; // หน่วยสตางค์ (Actual เก็บเป็น cents)
}

export interface Transaction {
	id: string;
	date: string;
	amount: number; // หน่วยสตางค์
	payee: string | null;
	notes: string | null;
}

export interface CashflowMonth {
	month: string; // 'YYYY-MM'
	totalDebt: number; // หน่วยสตางค์
}

export interface SummaryResponse {
	month: string;
	accounts: Account[];
	totalDebt: number;
	totalCash: number;
}

export interface TransactionsResponse {
	transactions: Transaction[];
}

export interface CashflowResponse {
	months: CashflowMonth[];
}
