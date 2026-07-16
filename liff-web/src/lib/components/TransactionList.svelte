<script lang="ts">
	import type { Transaction } from '$lib/types';

	let { transactions }: { transactions: Transaction[] } = $props();

	function formatBaht(cents: number): string {
		return (cents / 100).toLocaleString('th-TH', { style: 'currency', currency: 'THB' });
	}
</script>

{#if transactions.length === 0}
	<p class="text-sm text-gray-400">ยังไม่มีรายการ</p>
{:else}
	<ul class="space-y-1.5">
		{#each transactions as tx (tx.id)}
			<li
				class="flex justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
			>
				<span>{tx.payee ?? tx.notes ?? '-'}</span>
				<span class={tx.amount < 0 ? 'text-red-700' : 'text-green-700'}>
					{formatBaht(tx.amount)}
				</span>
			</li>
		{/each}
	</ul>
{/if}
