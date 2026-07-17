// ทุกยอดเงินหน่วยสตางค์ (Actual เก็บเป็น cents) — แปลงเป็นบาทตอนแสดงผลด้วย $lib/format

export interface Account {
	id: string;
	name: string;
	isCard: boolean;
	offBudget: boolean;
	balance: number;
	creditLimit: number | null; // วงเงินบัตร (สตางค์) — null = ยังไม่ได้ตั้ง
	dueDay: number | null; // วันครบกำหนดชำระ (1-31) — null = ยังไม่ได้ตั้ง
}

export interface AccountsResponse {
	accounts: Account[];
}

export interface Transaction {
	id: string;
	date: string; // 'YYYY-MM-DD'
	amount: number;
	payee: string | null;
	notes: string | null;
	accountId: string;
	accountName: string | null;
	category: string | null;
}

export interface TransactionsResponse {
	transactions: Transaction[];
}

export interface BudgetCategory {
	id: string;
	name: string;
	budgeted: number;
	spent: number; // ค่าลบ = ใช้จ่ายออก
	balance: number;
}

export interface BudgetGroup {
	id: string;
	name: string;
	isIncome: boolean;
	budgeted: number;
	spent: number;
	balance: number;
	categories: BudgetCategory[];
}

export interface BudgetResponse {
	month: string; // 'YYYY-MM'
	totalIncome: number;
	totalSpent: number;
	totalBudgeted: number;
	toBudget: number;
	groups: BudgetGroup[];
}

export interface Category {
	id: string;
	name: string;
	isIncome: boolean;
}

export interface CategoriesResponse {
	categories: Category[];
}

export interface ReflectMonth {
	month: string; // 'YYYY-MM'
	income: number;
	spent: number; // ค่าลบ
}

export interface ReflectResponse {
	months: ReflectMonth[];
}

export interface CashflowMonth {
	month: string; // 'YYYY-MM'
	totalDebt: number; // หนี้บัตรรวม ณ สิ้นเดือน (สตางค์, ค่าบวก)
}

export interface CashflowResponse {
	months: CashflowMonth[];
}

export interface NewTransaction {
	accountId: string;
	amount: number; // หน่วยบาท มีเครื่องหมาย +/- แล้ว (ฝั่ง bot คูณ 100 เอง)
	payee?: string;
	categoryId?: string;
	notes?: string;
	date?: string;
}
