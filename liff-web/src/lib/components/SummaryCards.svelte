<script lang="ts">
	import type { Account } from '$lib/types';

	let { accounts }: { accounts: Account[] } = $props();

	function formatBaht(cents: number): string {
		return (cents / 100).toLocaleString('th-TH', { style: 'currency', currency: 'THB' });
	}
</script>

{#if accounts.length === 0}
	<p class="text-sm text-gray-400">ยังไม่มีบัญชีใน Actual — สร้างบัญชีก่อนในหน้าเว็บ Actual</p>
{:else}
	<div class="grid grid-cols-2 gap-3">
		{#each accounts as account (account.id)}
			<div class="rounded-xl border border-gray-200 bg-white p-3">
				<div class="text-xs text-gray-400">{account.name}</div>
				<div
					class="mt-1 text-lg font-semibold {account.balance < 0
						? 'text-red-700'
						: 'text-green-700'}"
				>
					{formatBaht(account.balance)}
				</div>
			</div>
		{/each}
	</div>
{/if}
