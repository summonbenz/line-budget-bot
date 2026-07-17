<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureLiffReady } from '$lib/liff';
	import BudgetTab from '$lib/components/BudgetTab.svelte';
	import AccountsTab from '$lib/components/AccountsTab.svelte';
	import TransactionsTab from '$lib/components/TransactionsTab.svelte';
	import AddTab from '$lib/components/AddTab.svelte';
	import ReflectTab from '$lib/components/ReflectTab.svelte';

	type Tab = 'budget' | 'accounts' | 'add' | 'transactions' | 'reflect';

	let ready = $state(false);
	let errorMessage = $state('');
	let active = $state<Tab>('budget');
	// เก็บว่าแท็บไหนเคยเปิดแล้ว — แท็บที่เคยเปิด mount ค้างไว้ (ซ่อนด้วย CSS)
	// เพื่อคง state ภายใน (scroll, ช่องกรอก) ตอนสลับไปมา และไม่ fetch ซ้ำโดยไม่จำเป็น
	let visited = $state<Record<Tab, boolean>>({
		budget: true,
		accounts: false,
		add: false,
		transactions: false,
		reflect: false
	});

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'budget', label: 'งบ' },
		{ id: 'accounts', label: 'บัญชี' },
		{ id: 'add', label: 'เพิ่ม' },
		{ id: 'transactions', label: 'รายการ' },
		{ id: 'reflect', label: 'สรุป' }
	];

	function switchTab(tab: Tab) {
		active = tab;
		visited[tab] = true;
	}

	onMount(async () => {
		try {
			await ensureLiffReady();
			ready = true;
		} catch (err) {
			console.error(err);
			errorMessage = err instanceof Error ? err.message : 'เปิด LIFF ไม่สำเร็จ ลองใหม่อีกครั้ง';
		}
	});
</script>

<div class="mx-auto min-h-dvh max-w-md">
	{#if errorMessage}
		<div class="flex min-h-dvh items-center justify-center p-6">
			<div class="w-full rounded-2xl bg-white p-6 text-center shadow-sm">
				<p class="text-3xl">⚠️</p>
				<p class="mt-3 text-sm text-stone-600">{errorMessage}</p>
			</div>
		</div>
	{:else if !ready}
		<div class="flex min-h-dvh items-center justify-center">
			<div class="flex flex-col items-center gap-3 text-stone-400">
				<div
					class="h-8 w-8 animate-spin rounded-full border-[3px] border-stone-300 border-t-emerald-600"
				></div>
				<p class="text-sm">กำลังโหลด...</p>
			</div>
		</div>
	{:else}
		<main class="pb-28">
			{#if visited.budget}
				<div class:hidden={active !== 'budget'}><BudgetTab active={active === 'budget'} /></div>
			{/if}
			{#if visited.accounts}
				<div class:hidden={active !== 'accounts'}>
					<AccountsTab active={active === 'accounts'} />
				</div>
			{/if}
			{#if visited.add}
				<div class:hidden={active !== 'add'}><AddTab active={active === 'add'} /></div>
			{/if}
			{#if visited.transactions}
				<div class:hidden={active !== 'transactions'}>
					<TransactionsTab active={active === 'transactions'} />
				</div>
			{/if}
			{#if visited.reflect}
				<div class:hidden={active !== 'reflect'}><ReflectTab active={active === 'reflect'} /></div>
			{/if}
		</main>

		<nav
			class="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 backdrop-blur"
			style="padding-bottom: env(safe-area-inset-bottom)"
		>
			<div class="mx-auto grid max-w-md grid-cols-5">
				{#each tabs as tab (tab.id)}
					{@const isActive = active === tab.id}
					{#if tab.id === 'add'}
						<button
							type="button"
							class="flex flex-col items-center justify-center py-2"
							onclick={() => switchTab('add')}
							aria-label="เพิ่มรายการ"
						>
							<span
								class="flex h-11 w-11 items-center justify-center rounded-full shadow-md transition-colors
								{isActive ? 'bg-emerald-700' : 'bg-emerald-600'} text-white"
							>
								<svg
									viewBox="0 0 24 24"
									class="h-6 w-6"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								>
									<path d="M12 5v14M5 12h14" />
								</svg>
							</span>
						</button>
					{:else}
						<button
							type="button"
							class="flex flex-col items-center gap-0.5 pt-2.5 pb-1.5 transition-colors
							{isActive ? 'text-emerald-700' : 'text-stone-400'}"
							onclick={() => switchTab(tab.id)}
						>
							<svg
								viewBox="0 0 24 24"
								class="h-6 w-6"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								{#if tab.id === 'budget'}
									<path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" />
								{:else if tab.id === 'accounts'}
									<rect x="2.75" y="6" width="18.5" height="13" rx="2.5" />
									<path d="M2.75 10h18.5M6.5 15h3" />
								{:else if tab.id === 'transactions'}
									<path
										d="M7.5 4.5v13.5m0 0L4 14.5m3.5 3.5l3.5-3.5M16.5 19.5V6m0 0L13 9.5M16.5 6L20 9.5"
									/>
								{:else if tab.id === 'reflect'}
									<path d="M4.5 20v-5.5M10 20V9M15.5 20v-8M21 20V4.5" />
								{/if}
							</svg>
							<span class="text-[10px] font-medium">{tab.label}</span>
						</button>
					{/if}
				{/each}
			</div>
		</nav>
	{/if}
</div>
