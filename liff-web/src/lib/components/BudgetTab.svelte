<script lang="ts">
	import { getBudget, setBudget, UnauthorizedError } from '$lib/api';
	import { appState, markDataChanged } from '$lib/store.svelte';
	import { baht, currentMonth, shiftMonth, thaiMonth } from '$lib/format';
	import type { BudgetCategory, BudgetResponse } from '$lib/types';

	let { active }: { active: boolean } = $props();

	let month = $state(currentMonth());
	let data = $state<BudgetResponse | null>(null);
	let loading = $state(false);
	let error = $state('');
	let collapsed = $state<Record<string, boolean>>({});
	let editingId = $state<string | null>(null);
	let editValue = $state('');
	let saving = $state(false);

	// ค่าที่โหลดล่าสุด — ไว้เทียบว่าต้อง refetch ไหม (ไม่ใช่ $state เพราะไม่ต้อง trigger effect เอง)
	let loadedVersion = -1;
	let loadedMonth = '';

	async function load() {
		loading = true;
		error = '';
		try {
			data = await getBudget(month);
			loadedVersion = appState.dataVersion;
			loadedMonth = month;
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
		if (active && (loadedVersion !== appState.dataVersion || loadedMonth !== month)) {
			load();
		}
	});

	const expenseGroups = $derived((data?.groups ?? []).filter((g) => !g.isIncome));

	function spentAbs(c: { spent: number }): number {
		return c.spent < 0 ? -c.spent : 0;
	}

	function progress(c: BudgetCategory): number {
		if (c.budgeted <= 0) return spentAbs(c) > 0 ? 1 : 0;
		return Math.min(spentAbs(c) / c.budgeted, 1);
	}

	function barColor(c: BudgetCategory): string {
		const used = spentAbs(c);
		if (c.budgeted <= 0) return used > 0 ? 'bg-red-500' : 'bg-stone-300';
		const ratio = used / c.budgeted;
		if (ratio > 1) return 'bg-red-500';
		if (ratio >= 0.8) return 'bg-amber-500';
		return 'bg-emerald-500';
	}

	function startEdit(c: BudgetCategory) {
		editingId = c.id;
		editValue = c.budgeted === 0 ? '' : (c.budgeted / 100).toString();
	}

	async function commitEdit(c: BudgetCategory) {
		if (editingId !== c.id || saving) return;
		const raw = editValue.trim();
		editingId = null;

		const value = raw === '' ? 0 : Number(raw.replace(/,/g, ''));
		if (!Number.isFinite(value) || value < 0) return;

		const cents = Math.round(value * 100);
		if (cents === c.budgeted) return;

		saving = true;
		try {
			await setBudget(month, c.id, cents);
			markDataChanged(); // ทำให้ effect ด้านบน refetch ยอดรวมกลุ่ม/เดือนใหม่
		} catch (err) {
			console.error(err);
			error = 'บันทึกงบไม่สำเร็จ ลองใหม่อีกครั้ง';
		} finally {
			saving = false;
		}
	}

	function onEditKeydown(e: KeyboardEvent, c: BudgetCategory) {
		if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
		if (e.key === 'Escape') editingId = null;
	}

	function focusInput(node: HTMLInputElement) {
		node.focus();
		node.select();
	}
</script>

<header
	class="sticky top-0 z-10 border-b border-stone-200 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur"
>
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-bold text-stone-900">งบประมาณ</h1>
		<div class="flex items-center gap-1 rounded-full bg-white px-1 py-1 shadow-sm">
			<button
				type="button"
				class="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 active:bg-stone-100"
				onclick={() => (month = shiftMonth(month, -1))}
				aria-label="เดือนก่อนหน้า"
			>
				<svg
					viewBox="0 0 24 24"
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg
				>
			</button>
			<span class="min-w-20 text-center text-sm font-semibold text-stone-800"
				>{thaiMonth(month)}</span
			>
			<button
				type="button"
				class="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 active:bg-stone-100"
				onclick={() => (month = shiftMonth(month, 1))}
				aria-label="เดือนถัดไป"
			>
				<svg
					viewBox="0 0 24 24"
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg
				>
			</button>
		</div>
	</div>
</header>

<div class="space-y-3 px-4 pt-3">
	{#if error}
		<p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
	{/if}

	{#if loading && !data}
		<div class="space-y-3">
			{#each [1, 2, 3] as i (i)}
				<div class="h-24 animate-pulse rounded-2xl bg-stone-200"></div>
			{/each}
		</div>
	{:else if data}
		<!-- สรุปเดือน -->
		<section class="grid grid-cols-3 gap-2 rounded-2xl bg-white p-4 shadow-sm">
			<div>
				<p class="text-[11px] text-stone-400">รายรับ</p>
				<p class="tabular mt-0.5 text-sm font-semibold text-emerald-700">
					฿{baht(data.totalIncome)}
				</p>
			</div>
			<div>
				<p class="text-[11px] text-stone-400">ตั้งงบไว้</p>
				<p class="tabular mt-0.5 text-sm font-semibold text-stone-800">
					฿{baht(data.totalBudgeted)}
				</p>
			</div>
			<div>
				<p class="text-[11px] text-stone-400">ใช้ไปแล้ว</p>
				<p class="tabular mt-0.5 text-sm font-semibold text-red-600">฿{baht(-data.totalSpent)}</p>
			</div>
		</section>

		{#if expenseGroups.length === 0}
			<p class="py-10 text-center text-sm text-stone-400">
				ยังไม่มีหมวดงบประมาณ — สร้างหมวดก่อนในหน้าเว็บ Actual
			</p>
		{/if}

		<!-- กลุ่มหมวดหมู่ (พับ/กางได้) -->
		{#each expenseGroups as group (group.id)}
			<section class="overflow-hidden rounded-2xl bg-white shadow-sm">
				<button
					type="button"
					class="flex w-full items-center justify-between px-4 py-3 active:bg-stone-50"
					onclick={() => (collapsed[group.id] = !collapsed[group.id])}
				>
					<span class="flex items-center gap-2">
						<svg
							viewBox="0 0 24 24"
							class="h-3.5 w-3.5 text-stone-400 transition-transform {collapsed[group.id]
								? '-rotate-90'
								: ''}"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg
						>
						<span class="text-sm font-semibold text-stone-800">{group.name}</span>
					</span>
					<span class="tabular text-xs text-stone-500">
						เหลือ
						<span class="font-semibold {group.balance < 0 ? 'text-red-600' : 'text-stone-700'}">
							฿{baht(group.balance)}
						</span>
					</span>
				</button>

				{#if !collapsed[group.id]}
					<ul class="divide-y divide-stone-100 border-t border-stone-100">
						{#each group.categories as cat (cat.id)}
							<li class="px-4 py-2.5">
								<div class="flex items-baseline justify-between gap-2">
									<span class="truncate text-sm text-stone-700">{cat.name}</span>
									<span
										class="tabular shrink-0 text-sm font-semibold {cat.balance < 0
											? 'text-red-600'
											: 'text-stone-800'}"
									>
										฿{baht(cat.balance)}
									</span>
								</div>
								<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100">
									<div
										class="h-full rounded-full {barColor(cat)} transition-all"
										style="width: {progress(cat) * 100}%"
									></div>
								</div>
								<div class="mt-1 flex items-center justify-between text-[11px] text-stone-400">
									<span class="tabular">ใช้ไป ฿{baht(spentAbs(cat))}</span>
									{#if editingId === cat.id}
										<span class="tabular flex items-center gap-1">
											งบ ฿<input
												type="text"
												inputmode="decimal"
												class="w-20 rounded-md border border-emerald-500 bg-white px-1.5 py-0.5 text-right text-[11px] text-stone-800 outline-none"
												bind:value={editValue}
												use:focusInput
												onblur={() => commitEdit(cat)}
												onkeydown={(e) => onEditKeydown(e, cat)}
											/>
										</span>
									{:else}
										<button
											type="button"
											class="tabular rounded-md px-1 py-0.5 underline decoration-dotted underline-offset-2 active:bg-stone-100"
											onclick={() => startEdit(cat)}
										>
											งบ ฿{baht(cat.budgeted)}
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	{/if}
</div>
