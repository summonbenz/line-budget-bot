<script lang="ts">
	import { getAccounts, UnauthorizedError } from '$lib/api';
	import { appState } from '$lib/store.svelte';
	import { baht, bahtWhole } from '$lib/format';
	import type { Account } from '$lib/types';

	let { active }: { active: boolean } = $props();

	let accounts = $state<Account[]>([]);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let loadedVersion = -1;

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await getAccounts();
			accounts = res.accounts;
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

	const onBudget = $derived(accounts.filter((a) => !a.offBudget));
	const offBudget = $derived(accounts.filter((a) => a.offBudget));
	const netWorth = $derived(accounts.reduce((sum, a) => sum + a.balance, 0));
	const totalAssets = $derived(
		accounts.reduce((sum, a) => sum + (a.balance > 0 ? a.balance : 0), 0)
	);
	const totalDebt = $derived(
		accounts.reduce((sum, a) => sum + (a.balance < 0 ? -a.balance : 0), 0)
	);

	function sum(list: Account[]): number {
		return list.reduce((s, a) => s + a.balance, 0);
	}
</script>

<header
	class="sticky top-0 z-10 border-b border-stone-200 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur"
>
	<h1 class="text-lg font-bold text-stone-900">บัญชี</h1>
</header>

<div class="space-y-3 px-4 pt-3">
	{#if error}
		<p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
	{/if}

	{#if loading && !loaded}
		<div class="space-y-3">
			<div class="h-28 animate-pulse rounded-2xl bg-stone-200"></div>
			<div class="h-40 animate-pulse rounded-2xl bg-stone-200"></div>
		</div>
	{:else if loaded}
		<!-- มูลค่าสุทธิ -->
		<section class="rounded-2xl bg-white p-5 shadow-sm">
			<p class="text-xs text-stone-400">มูลค่าสุทธิ</p>
			<p class="tabular mt-1 text-3xl font-bold {netWorth < 0 ? 'text-red-600' : 'text-stone-900'}">
				{bahtWhole(netWorth)}
			</p>
			<div class="mt-3 flex gap-4 border-t border-stone-100 pt-3 text-xs">
				<span class="text-stone-400">
					สินทรัพย์ <span class="tabular font-semibold text-emerald-700">฿{baht(totalAssets)}</span>
				</span>
				<span class="text-stone-400">
					หนี้สิน <span class="tabular font-semibold text-red-600">฿{baht(totalDebt)}</span>
				</span>
			</div>
		</section>

		{#if accounts.length === 0}
			<p class="py-10 text-center text-sm text-stone-400">
				ยังไม่มีบัญชีใน Actual — สร้างบัญชีก่อนในหน้าเว็บ Actual
			</p>
		{/if}

		{#each [{ title: 'ในงบประมาณ', list: onBudget }, { title: 'นอกงบประมาณ', list: offBudget }] as section (section.title)}
			{#if section.list.length > 0}
				<section class="overflow-hidden rounded-2xl bg-white shadow-sm">
					<div class="flex items-center justify-between px-4 pt-3 pb-1">
						<h2 class="text-xs font-semibold text-stone-400">{section.title}</h2>
						<span
							class="tabular text-xs font-semibold {sum(section.list) < 0
								? 'text-red-600'
								: 'text-stone-600'}"
						>
							฿{baht(sum(section.list))}
						</span>
					</div>
					<ul class="divide-y divide-stone-100">
						{#each section.list as account (account.id)}
							<li class="flex items-center justify-between gap-2 px-4 py-3">
								<span class="flex min-w-0 items-center gap-2">
									<span class="truncate text-sm text-stone-800">{account.name}</span>
									{#if account.isCard}
										<span
											class="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700"
										>
											บัตรเครดิต
										</span>
									{/if}
								</span>
								<span
									class="tabular shrink-0 text-sm font-semibold {account.balance < 0
										? 'text-red-600'
										: 'text-stone-800'}"
								>
									฿{baht(account.balance)}
								</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}
	{/if}
</div>
