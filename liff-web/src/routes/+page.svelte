<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureLiffReady } from '$lib/liff';
	import { getSummary, getTransactions, getCashflow, UnauthorizedError } from '$lib/api';
	import type { Account, Transaction, CashflowMonth } from '$lib/types';
	import SummaryCards from '$lib/components/SummaryCards.svelte';
	import CashflowChart from '$lib/components/CashflowChart.svelte';
	import TransactionList from '$lib/components/TransactionList.svelte';

	let status = $state('กำลังโหลด...');
	let errorMessage = $state('');
	let accounts = $state<Account[]>([]);
	let months = $state<CashflowMonth[]>([]);
	let transactions = $state<Transaction[]>([]);

	onMount(async () => {
		try {
			await ensureLiffReady();

			const month = new Date().toISOString().slice(0, 7);
			const [summary, cashflow, txData] = await Promise.all([
				getSummary(month),
				getCashflow(),
				getTransactions()
			]);

			accounts = summary.accounts;
			months = cashflow.months;
			transactions = txData.transactions;
			status = '';
		} catch (err) {
			console.error(err);
			status = '';
			errorMessage =
				err instanceof UnauthorizedError
					? 'บัญชีนี้ไม่มีสิทธิ์เข้าดูข้อมูล'
					: 'โหลดข้อมูลไม่สำเร็จ ลองเปิดใหม่อีกครั้ง';
		}
	});
</script>

<div class="mx-auto max-w-md space-y-6 p-4">
	<h1 class="text-xl font-semibold">สรุปการเงินของฉัน</h1>

	{#if status}
		<p class="text-xs text-gray-400">{status}</p>
	{/if}

	{#if errorMessage}
		<p class="text-sm text-red-700">{errorMessage}</p>
	{:else}
		<section>
			<h2 class="mb-2 text-sm text-gray-500">ยอดคงเหลือแต่ละบัญชี</h2>
			<SummaryCards {accounts} />
		</section>

		<section>
			<h2 class="mb-2 text-sm text-gray-500">หนี้รวมรายเดือน (cashflow)</h2>
			<CashflowChart {months} />
		</section>

		<section>
			<h2 class="mb-2 text-sm text-gray-500">รายการล่าสุด</h2>
			<TransactionList {transactions} />
		</section>
	{/if}
</div>
