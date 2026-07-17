<script lang="ts">
	import { getAccounts, setCardLimit, UnauthorizedError } from '$lib/api';
	import { appState, markDataChanged } from '$lib/store.svelte';
	import { baht, bahtWhole } from '$lib/format';
	import type { Account } from '$lib/types';

	let { active }: { active: boolean } = $props();

	let accounts = $state<Account[]>([]);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let loadedVersion = -1;

	// แก้วงเงิน inline + ฟอร์มเพิ่มบัตรใหม่
	let editingId = $state<string | null>(null);
	let editValue = $state('');
	let addingCard = $state(false);
	let addAccountId = $state('');
	let addLimitValue = $state('');
	let saving = $state(false);

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

	const cards = $derived(accounts.filter((a) => a.isCard));
	const nonCards = $derived(accounts.filter((a) => !a.isCard));
	const chartCards = $derived(cards.filter((a) => a.creditLimit != null && a.creditLimit > 0));

	function sum(list: Account[]): number {
		return list.reduce((s, a) => s + a.balance, 0);
	}

	/** หนี้ของบัตร (สตางค์, ค่าบวก) — บัตรที่ยอดไม่ติดลบถือว่าไม่มีหนี้ */
	function debt(a: Account): number {
		return a.balance < 0 ? -a.balance : 0;
	}

	/** วงเงินคงเหลือ = วงเงิน - หนี้ (ติดลบได้ถ้ารูดเกิน) */
	function remaining(a: Account): number {
		return (a.creditLimit ?? 0) - debt(a);
	}

	// ---- แก้วงเงิน inline ----
	function startEdit(a: Account) {
		editingId = a.id;
		editValue = a.creditLimit ? (a.creditLimit / 100).toString() : '';
	}

	async function commitEdit(a: Account) {
		if (editingId !== a.id || saving) return;
		const raw = editValue.trim();
		editingId = null;

		const value = raw === '' ? 0 : Number(raw.replace(/,/g, ''));
		if (!Number.isFinite(value) || value < 0) return;
		if (Math.round(value * 100) === (a.creditLimit ?? 0)) return;

		await saveLimit(a.id, value);
	}

	// ---- เพิ่มบัตรใหม่ (ผูกบัญชี Actual + ตั้งวงเงินครั้งแรก) ----
	async function commitAdd() {
		const value = Number(addLimitValue.trim().replace(/,/g, ''));
		if (!addAccountId || !Number.isFinite(value) || value <= 0) return;
		await saveLimit(addAccountId, value);
		addingCard = false;
		addAccountId = '';
		addLimitValue = '';
	}

	async function saveLimit(accountId: string, creditLimitBaht: number) {
		saving = true;
		error = '';
		try {
			await setCardLimit(accountId, creditLimitBaht);
			markDataChanged(); // ให้ effect ด้านบน refetch — วงเงิน/สถานะบัตรเปลี่ยน
		} catch (err) {
			console.error(err);
			error = 'บันทึกวงเงินไม่สำเร็จ ลองใหม่อีกครั้ง';
		} finally {
			saving = false;
		}
	}

	function onEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
		if (e.key === 'Escape') editingId = null;
	}

	function focusInput(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	// ---- bar chart ใช้ไป vs คงเหลือ (Chart.js โหลดจาก CDN — ดู src/app.html) ----
	// น้ำเงินเข้ม/อ่อนเฉดเดียวกัน (fill vs track) แยกกันด้วยความสว่าง อ่านได้แม้ตาบอดสี
	const USED_COLOR = '#2a78d6';
	const USED_OVER_COLOR = '#d03b3b'; // รูดเกินวงเงิน
	const REMAINING_COLOR = '#b7d3f6';

	let canvas = $state<HTMLCanvasElement | undefined>(undefined);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let chart: any;

	function draw() {
		if (!canvas || !window.Chart || chartCards.length === 0) return;

		chart?.destroy();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ChartCtor = window.Chart as any;
		chart = new ChartCtor(canvas, {
			type: 'bar',
			data: {
				labels: chartCards.map((a) => a.name),
				datasets: [
					{
						label: 'ใช้ไป',
						data: chartCards.map((a) => debt(a) / 100),
						backgroundColor: chartCards.map((a) =>
							debt(a) > (a.creditLimit ?? 0) ? USED_OVER_COLOR : USED_COLOR
						),
						borderColor: '#ffffff',
						borderWidth: 1,
						borderRadius: { topLeft: 4, bottomLeft: 4 },
						borderSkipped: false,
						maxBarThickness: 22
					},
					{
						label: 'คงเหลือ',
						data: chartCards.map((a) => Math.max(remaining(a), 0) / 100),
						backgroundColor: REMAINING_COLOR,
						borderColor: '#ffffff',
						borderWidth: 1,
						borderRadius: { topRight: 4, bottomRight: 4 },
						borderSkipped: false,
						maxBarThickness: 22
					}
				]
			},
			options: {
				indexAxis: 'y',
				maintainAspectRatio: false,
				plugins: {
					legend: {
						position: 'top',
						align: 'end',
						labels: {
							usePointStyle: true,
							pointStyle: 'circle',
							boxWidth: 6,
							boxHeight: 6,
							color: '#52514e',
							font: { size: 11 }
						}
					},
					tooltip: {
						callbacks: {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							label: (ctx: any) =>
								`${ctx.dataset.label}: ฿${Number(ctx.parsed.x).toLocaleString('th-TH', {
									minimumFractionDigits: 2
								})}`
						}
					}
				},
				scales: {
					x: {
						stacked: true,
						beginAtZero: true,
						grid: { color: '#e1e0d9' },
						border: { display: false },
						ticks: {
							color: '#898781',
							font: { size: 10 },
							maxTicksLimit: 5,
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							callback: (v: any) =>
								new Intl.NumberFormat('th-TH', { notation: 'compact' }).format(Number(v))
						}
					},
					y: {
						stacked: true,
						grid: { display: false },
						border: { color: '#c3c2b7' },
						ticks: { color: '#52514e', font: { size: 11 } }
					}
				}
			}
		});
	}

	$effect(() => {
		chartCards;
		canvas;
		draw();
		return () => chart?.destroy();
	});
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

		<!-- บัตรเครดิต + วงเงิน -->
		<section class="rounded-2xl bg-white p-4 shadow-sm">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold text-stone-800">บัตรเครดิต</h2>
				{#if !addingCard && nonCards.length > 0}
					<button
						type="button"
						class="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 active:bg-stone-200"
						onclick={() => (addingCard = true)}
					>
						+ เพิ่มบัตร
					</button>
				{/if}
			</div>

			{#if addingCard}
				<div class="mt-3 space-y-2 rounded-xl bg-stone-50 p-3">
					<select
						class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none"
						bind:value={addAccountId}
					>
						<option value="" disabled>เลือกบัญชีที่เป็นบัตรเครดิต</option>
						{#each nonCards as account (account.id)}
							<option value={account.id}>{account.name}</option>
						{/each}
					</select>
					<input
						type="text"
						inputmode="decimal"
						placeholder="วงเงิน (บาท) เช่น 50000"
						class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400"
						bind:value={addLimitValue}
					/>
					<div class="flex gap-2">
						<button
							type="button"
							class="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-40"
							disabled={saving || !addAccountId || !addLimitValue.trim()}
							onclick={commitAdd}
						>
							บันทึก
						</button>
						<button
							type="button"
							class="flex-1 rounded-lg bg-stone-200 py-2 text-sm font-medium text-stone-600 active:bg-stone-300"
							onclick={() => (addingCard = false)}
						>
							ยกเลิก
						</button>
					</div>
				</div>
			{/if}

			{#if cards.length === 0}
				{#if !addingCard}
					<p class="mt-3 py-4 text-center text-sm text-stone-400">
						ยังไม่ได้ผูกบัตรเครดิต — กด "+ เพิ่มบัตร" เพื่อเลือกบัญชีและตั้งวงเงิน
					</p>
				{/if}
			{:else}
				<!-- กราฟใช้ไป vs คงเหลือ -->
				{#if chartCards.length > 0}
					<div class="mt-2" style="height: {chartCards.length * 44 + 64}px">
						<canvas bind:this={canvas}></canvas>
					</div>
				{/if}

				<!-- รายละเอียดต่อใบ + แก้วงเงิน -->
				<ul class="mt-2 divide-y divide-stone-100">
					{#each cards as card (card.id)}
						{@const over = card.creditLimit != null && debt(card) > card.creditLimit}
						<li class="py-2.5">
							<div class="flex items-baseline justify-between gap-2">
								<span class="truncate text-sm text-stone-800">{card.name}</span>
								{#if card.creditLimit != null}
									<span
										class="tabular shrink-0 text-sm font-semibold {remaining(card) < 0
											? 'text-red-600'
											: 'text-emerald-700'}"
									>
										เหลือ ฿{baht(remaining(card))}
									</span>
								{/if}
							</div>
							<div class="mt-1 flex items-center justify-between text-[11px] text-stone-400">
								<span class="tabular {over ? 'font-semibold text-red-600' : ''}">
									ใช้ไป ฿{baht(debt(card))}{over ? ' (เกินวงเงิน!)' : ''}
								</span>
								{#if editingId === card.id}
									<span class="tabular flex items-center gap-1">
										วงเงิน ฿<input
											type="text"
											inputmode="decimal"
											class="w-24 rounded-md border border-emerald-500 bg-white px-1.5 py-0.5 text-right text-[11px] text-stone-800 outline-none"
											bind:value={editValue}
											use:focusInput
											onblur={() => commitEdit(card)}
											onkeydown={onEditKeydown}
										/>
									</span>
								{:else}
									<button
										type="button"
										class="tabular rounded-md px-1 py-0.5 underline decoration-dotted underline-offset-2 active:bg-stone-100"
										onclick={() => startEdit(card)}
									>
										วงเงิน {card.creditLimit != null
											? `฿${baht(card.creditLimit)}`
											: 'ยังไม่ตั้ง — แตะเพื่อกำหนด'}
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
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
