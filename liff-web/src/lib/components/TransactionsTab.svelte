<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { getAccounts, getTransactions, UnauthorizedError } from '$lib/api';
	import { appState } from '$lib/store.svelte';
	import { baht, thaiDate } from '$lib/format';
	import type { Account, Transaction } from '$lib/types';

	let { active }: { active: boolean } = $props();

	let transactions = $state<Transaction[]>([]);
	let accounts = $state<Account[]>([]);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let loadedVersion = -1;

	let search = $state('');
	let typeFilter = $state<'all' | 'income' | 'expense'>('all');
	let accountFilter = $state('all');

	async function load() {
		loading = true;
		error = '';
		try {
			const [txRes, accRes] = await Promise.all([getTransactions(), getAccounts()]);
			transactions = txRes.transactions;
			accounts = accRes.accounts;
			loaded = true;
			loadedVersion = appState.dataVersion;
		} catch (err) {
			console.error(err);
			error =
				err instanceof UnauthorizedError
					? 'บัญชีนี้ไม่มีสิทธิ์เข้าดูข้อมูล'
					: 'โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (active && loadedVersion !== appState.dataVersion) load();
	});

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return transactions.filter((t) => {
			if (typeFilter === 'income' && t.amount <= 0) return false;
			if (typeFilter === 'expense' && t.amount >= 0) return false;
			if (accountFilter !== 'all' && t.accountId !== accountFilter) return false;
			if (q) {
				const haystack = `${t.payee ?? ''} ${t.notes ?? ''} ${t.category ?? ''}`.toLowerCase();
				if (!haystack.includes(q)) return false;
			}
			return true;
		});
	});

	// จัดกลุ่มตามวันที่ (รายการเรียงวันที่ล่าสุดมาก่อนอยู่แล้วจาก API)
	const groups = $derived.by(() => {
		const out: { date: string; items: Transaction[]; total: number }[] = [];
		for (const t of filtered) {
			const last = out[out.length - 1];
			if (last && last.date === t.date) {
				last.items.push(t);
				last.total += t.amount;
			} else {
				out.push({ date: t.date, items: [t], total: t.amount });
			}
		}
		return out;
	});

	const typeChips = [
		{ id: 'all', label: 'ทั้งหมด' },
		{ id: 'income', label: 'รายรับ' },
		{ id: 'expense', label: 'รายจ่าย' }
	] as const;

	// เปิดหน้าแก้ไขของรายการ — ส่ง id ธุรกรรม Actual ไปตรงๆ (ฝั่ง bot จับคู่/สร้าง entry ให้เอง)
	// accountId ช่วยให้ bot ไม่ต้องไล่หาทุกบัญชี, back=list ให้หน้าแก้ไขเด้งกลับแท็บนี้ตอนเสร็จ
	function openEdit(tx: Transaction) {
		goto(`${base}/edit/${tx.id}?accountId=${encodeURIComponent(tx.accountId)}&back=list`);
	}
</script>

<header
	class="sticky top-0 z-10 space-y-2 border-b border-stone-200 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur"
>
	<h1 class="text-lg font-bold text-stone-900">รายการ</h1>

	<div class="relative">
		<svg
			viewBox="0 0 24 24"
			class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-stone-400"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg
		>
		<input
			type="search"
			placeholder="ค้นหาร้านค้า โน้ต หมวดหมู่..."
			class="w-full rounded-full border-none bg-white py-2.5 pr-4 pl-10 text-sm text-stone-800 shadow-sm outline-none placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-500"
			bind:value={search}
		/>
	</div>

	<div class="flex items-center gap-1.5 overflow-x-auto pb-0.5">
		{#each typeChips as chip (chip.id)}
			<button
				type="button"
				class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors
				{typeFilter === chip.id ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600 shadow-sm'}"
				onclick={() => (typeFilter = chip.id)}
			>
				{chip.label}
			</button>
		{/each}
		<select
			class="ml-auto shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-stone-600 shadow-sm outline-none"
			bind:value={accountFilter}
		>
			<option value="all">ทุกบัญชี</option>
			{#each accounts as account (account.id)}
				<option value={account.id}>{account.name}</option>
			{/each}
		</select>
	</div>
</header>

<div class="px-4 pt-3">
	{#if error}
		<p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
	{/if}

	{#if loading && !loaded}
		<div class="space-y-3">
			{#each [1, 2, 3, 4] as i (i)}
				<div class="h-16 animate-pulse rounded-2xl bg-stone-200"></div>
			{/each}
		</div>
	{:else if loaded}
		{#if groups.length === 0}
			<p class="py-10 text-center text-sm text-stone-400">
				{search || typeFilter !== 'all' || accountFilter !== 'all'
					? 'ไม่พบรายการที่ตรงกับตัวกรอง'
					: 'ยังไม่มีรายการ'}
			</p>
		{/if}

		<div class="space-y-4">
			{#each groups as group (group.date)}
				<section>
					<div class="mb-1.5 flex items-baseline justify-between px-1">
						<h2 class="text-xs font-semibold text-stone-500">{thaiDate(group.date)}</h2>
						<span
							class="tabular text-[11px] {group.total < 0 ? 'text-stone-400' : 'text-emerald-700'}"
						>
							{group.total < 0 ? '−' : '+'}฿{baht(Math.abs(group.total))}
						</span>
					</div>
					<ul class="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white shadow-sm">
						{#each group.items as tx (tx.id)}
							<li>
								<button
									type="button"
									class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors active:bg-stone-100"
									onclick={() => openEdit(tx)}
								>
									<div class="min-w-0">
										<p class="truncate text-sm text-stone-800">
											{tx.payee ?? tx.notes ?? '(ไม่ระบุ)'}
										</p>
										<p class="mt-0.5 truncate text-[11px] text-stone-400">
											{[tx.category, tx.accountName].filter(Boolean).join(' • ') || '—'}
										</p>
									</div>
									<span
										class="tabular shrink-0 text-sm font-semibold {tx.amount < 0
											? 'text-stone-800'
											: 'text-emerald-700'}"
									>
										{tx.amount < 0 ? '−' : '+'}฿{baht(Math.abs(tx.amount))}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</div>
