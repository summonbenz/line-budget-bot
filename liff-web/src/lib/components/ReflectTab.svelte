<script lang="ts">
	import { getAccounts, getBudget, getReflect, UnauthorizedError } from '$lib/api';
	import { appState } from '$lib/store.svelte';
	import { baht, bahtWhole, currentMonth, thaiMonth, thaiMonthShort } from '$lib/format';
	import type { ReflectMonth } from '$lib/types';

	let { active }: { active: boolean } = $props();

	let months = $state<ReflectMonth[]>([]);
	let netWorth = $state(0);
	let breakdown = $state<{ name: string; spent: number }[]>([]);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let loadedVersion = -1;

	let canvas = $state<HTMLCanvasElement | undefined>(undefined);
	// Chart.js โหลดจาก CDN เป็น global (ไม่มี type จริง) — ดู src/app.html
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let chart: any;

	async function load() {
		loading = true;
		error = '';
		try {
			const [reflectRes, accRes, budgetRes] = await Promise.all([
				getReflect(6),
				getAccounts(),
				getBudget(currentMonth())
			]);
			months = reflectRes.months;
			netWorth = accRes.accounts.reduce((sum, a) => sum + a.balance, 0);

			// รายจ่ายรายหมวดของเดือนนี้ เรียงมาก→น้อย เกิน 7 หมวดพับเป็น "อื่นๆ"
			const cats = budgetRes.groups
				.filter((g) => !g.isIncome)
				.flatMap((g) => g.categories)
				.filter((c) => c.spent < 0)
				.map((c) => ({ name: c.name, spent: -c.spent }))
				.sort((a, b) => b.spent - a.spent);
			breakdown =
				cats.length > 7
					? [
							...cats.slice(0, 6),
							{ name: 'อื่นๆ', spent: cats.slice(6).reduce((s, c) => s + c.spent, 0) }
						]
					: cats;

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

	// สีผ่าน dataviz validator แล้ว (CVD-safe บนพื้นขาว): เขียว=รายรับ น้ำเงิน=รายจ่าย
	const INCOME_COLOR = '#008300';
	const SPENDING_COLOR = '#2a78d6';

	function draw() {
		if (!canvas || !window.Chart || months.length === 0) return;

		chart?.destroy();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ChartCtor = window.Chart as any;
		chart = new ChartCtor(canvas, {
			type: 'bar',
			data: {
				labels: months.map((m) => thaiMonthShort(m.month)),
				datasets: [
					{
						label: 'รายรับ',
						data: months.map((m) => m.income / 100),
						backgroundColor: INCOME_COLOR,
						borderRadius: { topLeft: 4, topRight: 4 },
						borderSkipped: 'bottom',
						maxBarThickness: 16
					},
					{
						label: 'รายจ่าย',
						data: months.map((m) => Math.abs(m.spent) / 100),
						backgroundColor: SPENDING_COLOR,
						borderRadius: { topLeft: 4, topRight: 4 },
						borderSkipped: 'bottom',
						maxBarThickness: 16
					}
				]
			},
			options: {
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
								`${ctx.dataset.label}: ฿${Number(ctx.parsed.y).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
						}
					}
				},
				scales: {
					x: {
						grid: { display: false },
						border: { color: '#c3c2b7' },
						ticks: { color: '#898781', font: { size: 11 } }
					},
					y: {
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
					}
				}
			}
		});
	}

	$effect(() => {
		months;
		canvas;
		draw();
		return () => chart?.destroy();
	});

	const maxSpent = $derived(breakdown.reduce((max, c) => Math.max(max, c.spent), 0));
	const totalSpent = $derived(breakdown.reduce((sum, c) => sum + c.spent, 0));
</script>

<header
	class="sticky top-0 z-10 border-b border-stone-200 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur"
>
	<h1 class="text-lg font-bold text-stone-900">สรุปภาพรวม</h1>
</header>

<div class="space-y-3 px-4 pt-3">
	{#if error}
		<p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
	{/if}

	{#if loading && !loaded}
		<div class="space-y-3">
			<div class="h-24 animate-pulse rounded-2xl bg-stone-200"></div>
			<div class="h-64 animate-pulse rounded-2xl bg-stone-200"></div>
		</div>
	{:else if loaded}
		<!-- มูลค่าสุทธิ -->
		<section class="rounded-2xl bg-white p-5 shadow-sm">
			<p class="text-xs text-stone-400">มูลค่าสุทธิตอนนี้</p>
			<p class="tabular mt-1 text-3xl font-bold {netWorth < 0 ? 'text-red-600' : 'text-stone-900'}">
				{bahtWhole(netWorth)}
			</p>
		</section>

		<!-- กราฟรายรับ vs รายจ่าย -->
		<section class="rounded-2xl bg-white p-4 shadow-sm">
			<h2 class="text-sm font-semibold text-stone-800">รายรับ vs รายจ่าย</h2>
			<p class="text-[11px] text-stone-400">ย้อนหลัง 6 เดือน (บาท)</p>
			<div class="mt-2 h-52">
				<canvas bind:this={canvas}></canvas>
			</div>
		</section>

		<!-- รายจ่ายตามหมวด เดือนนี้ -->
		<section class="rounded-2xl bg-white p-4 shadow-sm">
			<div class="flex items-baseline justify-between">
				<h2 class="text-sm font-semibold text-stone-800">รายจ่ายตามหมวด</h2>
				<span class="text-[11px] text-stone-400">{thaiMonth(currentMonth())}</span>
			</div>
			{#if breakdown.length === 0}
				<p class="py-6 text-center text-sm text-stone-400">เดือนนี้ยังไม่มีรายจ่าย</p>
			{:else}
				<ul class="mt-3 space-y-2.5">
					{#each breakdown as cat (cat.name)}
						<li>
							<div class="flex items-baseline justify-between gap-2 text-sm">
								<span class="truncate text-stone-700">{cat.name}</span>
								<span class="tabular shrink-0 text-xs font-semibold text-stone-800">
									฿{baht(cat.spent)}
								</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100">
								<div
									class="h-full rounded-full"
									style="width: {maxSpent > 0
										? (cat.spent / maxSpent) * 100
										: 0}%; background-color: {SPENDING_COLOR}"
								></div>
							</div>
						</li>
					{/each}
				</ul>
				<p class="tabular mt-3 border-t border-stone-100 pt-2 text-right text-xs text-stone-500">
					รวม <span class="font-semibold text-stone-800">฿{baht(totalSpent)}</span>
				</p>
			{/if}
		</section>
	{/if}
</div>
