<script lang="ts">
	import { getAccounts, getBudget, getCashflow, getReflect, UnauthorizedError } from '$lib/api';
	import { appState } from '$lib/store.svelte';
	import { baht, bahtWhole, currentMonth, shiftMonth, thaiMonth, thaiMonthShort } from '$lib/format';
	import type { CashflowMonth, ReflectMonth } from '$lib/types';

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
			netWorth = accRes.accounts
				.filter((a) => !a.offBudget)
				.reduce((sum, a) => sum + a.balance, 0);

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

	// ---- กราฟแนวโน้มหนี้บัตร + เส้นประ forecast ----

	const DEBT_PERIODS = [
		{ label: '3 เดือน', months: 3 },
		{ label: '6 เดือน', months: 6 },
		{ label: '1 ปี', months: 12 },
		{ label: '2 ปี', months: 24 }
	];
	// จำนวนเดือนที่ยิงเส้น forecast ต่อจากข้อมูลจริง — สเกลตามช่วงที่เลือก
	const FORECAST_HORIZON: Record<number, number> = { 3: 3, 6: 3, 12: 4, 24: 6 };

	// สีม่วงผ่าน dataviz validator บนพื้นขาวแล้ว — คนละสีกับกราฟรายรับ/รายจ่ายกันสับสน
	const DEBT_COLOR = '#4a3aa7';

	let debtMonths = $state<CashflowMonth[]>([]);
	let debtPeriod = $state(6);
	let debtLoading = $state(false);
	let debtLoaded = $state(false);
	let debtLoadKey = ''; // "<dataVersion>:<period>" กันโหลดซ้ำ
	let debtReqId = 0; // กัน response เก่าที่มาช้าทับ response ใหม่ตอนกดสลับช่วงรัวๆ

	let debtCanvas = $state<HTMLCanvasElement | undefined>(undefined);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let debtChart: any;

	async function loadDebt() {
		const reqId = ++debtReqId;
		debtLoading = true;
		try {
			const res = await getCashflow(debtPeriod);
			if (reqId !== debtReqId) return;
			debtMonths = res.months;
			debtLoaded = true;
			debtLoadKey = `${appState.dataVersion}:${debtPeriod}`;
		} catch (err) {
			console.error(err);
		} finally {
			if (reqId === debtReqId) debtLoading = false;
		}
	}

	$effect(() => {
		if (active && debtLoadKey !== `${appState.dataVersion}:${debtPeriod}`) loadDebt();
	});

	/** least-squares เส้นตรงจากข้อมูลจริง → ค่าพยากรณ์ horizon เดือนข้างหน้า (หน่วยสตางค์) */
	function linearForecast(values: number[], horizon: number): { points: number[]; slope: number } {
		const n = values.length;
		if (n < 2) return { points: [], slope: 0 };
		const xMean = (n - 1) / 2;
		const yMean = values.reduce((s, v) => s + v, 0) / n;
		let num = 0;
		let den = 0;
		for (let i = 0; i < n; i++) {
			num += (i - xMean) * (values[i] - yMean);
			den += (i - xMean) * (i - xMean);
		}
		const slope = num / den;
		const intercept = yMean - slope * xMean;
		const points: number[] = [];
		for (let k = 1; k <= horizon; k++) {
			points.push(Math.max(0, intercept + slope * (n - 1 + k))); // หนี้ติดลบไม่มีจริง
		}
		return { points, slope };
	}

	const debtForecast = $derived(
		linearForecast(
			debtMonths.map((m) => m.totalDebt),
			FORECAST_HORIZON[debtPeriod] ?? 3
		)
	);
	const hasDebtData = $derived(debtMonths.some((m) => m.totalDebt > 0));
	const currentDebt = $derived(debtMonths.at(-1)?.totalDebt ?? 0);
	// slope ระดับ ±฿1/เดือนถือว่าทรงตัว
	const debtTrend = $derived(
		debtForecast.slope < -100 ? 'down' : debtForecast.slope > 100 ? 'up' : 'flat'
	);
	const monthsToZero = $derived(
		debtTrend === 'down' && currentDebt > 0 ? Math.ceil(currentDebt / -debtForecast.slope) : null
	);

	function drawDebt() {
		if (!debtCanvas || !window.Chart || debtMonths.length === 0) return;

		debtChart?.destroy();

		const n = debtMonths.length;
		const monthKeys = debtMonths.map((m) => m.month);
		let fm = debtMonths[n - 1].month;
		for (let k = 0; k < debtForecast.points.length; k++) {
			fm = shiftMonth(fm, 1);
			monthKeys.push(fm);
		}
		// ช่วงยาวเกิน 12 เดือนชื่อเดือนซ้ำกันได้ — เติมปี พ.ศ. 2 หลักกำกับ
		const withYear = monthKeys.length > 12;
		const labels = monthKeys.map((m) => {
			const s = thaiMonthShort(m);
			return withYear ? `${s} ${(Number(m.slice(0, 4)) + 543) % 100}` : s;
		});

		const actualData: (number | null)[] = [
			...debtMonths.map((m) => m.totalDebt / 100),
			...debtForecast.points.map(() => null)
		];
		// เส้น forecast เริ่มที่จุดจริงจุดสุดท้ายเพื่อให้เส้นประต่อเนื่องจากเส้นจริง
		const forecastData: (number | null)[] = [
			...debtMonths.slice(0, -1).map(() => null),
			debtMonths[n - 1].totalDebt / 100,
			...debtForecast.points.map((v) => v / 100)
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ChartCtor = window.Chart as any;
		debtChart = new ChartCtor(debtCanvas, {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'หนี้จริง',
						data: actualData,
						borderColor: DEBT_COLOR,
						backgroundColor: 'rgba(74, 58, 167, 0.08)',
						fill: true,
						borderWidth: 2,
						tension: 0.3,
						// โชว์เฉพาะจุดสุดท้ายของข้อมูลจริง พร้อมวงแหวนขาวกันจมเส้น
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						pointRadius: (ctx: any) => (ctx.dataIndex === n - 1 ? 4 : 0),
						pointBackgroundColor: DEBT_COLOR,
						pointBorderColor: '#ffffff',
						pointBorderWidth: 2,
						pointHitRadius: 12
					},
					{
						label: 'คาดการณ์',
						data: forecastData,
						borderColor: DEBT_COLOR,
						borderDash: [5, 4],
						borderWidth: 2,
						fill: false,
						tension: 0.3,
						pointRadius: 0,
						pointHitRadius: 12,
						pointStyle: 'line' // ให้ swatch ใน legend เป็นเส้น (ประ) ไม่ใช่วงกลมสีเดียวกับหนี้จริง
					}
				]
			},
			options: {
				maintainAspectRatio: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: {
						position: 'top',
						align: 'end',
						labels: {
							usePointStyle: true,
							boxWidth: 14,
							boxHeight: 8,
							color: '#52514e',
							font: { size: 11 }
						}
					},
					tooltip: {
						// จุดต่อเชื่อมของเส้น forecast ซ้ำกับจุดจริงสุดท้าย — ไม่ต้องโชว์ซ้ำ
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						filter: (item: any) => !(item.datasetIndex === 1 && item.dataIndex === n - 1),
						callbacks: {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							title: (items: any[]) => (items[0] ? thaiMonth(monthKeys[items[0].dataIndex]) : ''),
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
						ticks: { color: '#898781', font: { size: 10 }, maxRotation: 0, autoSkipPadding: 8 }
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
		debtMonths;
		debtForecast;
		debtCanvas;
		drawDebt();
		return () => debtChart?.destroy();
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

		<!-- แนวโน้มหนี้บัตรเครดิต + เส้นประ forecast -->
		<section class="rounded-2xl bg-white p-4 shadow-sm">
			<h2 class="text-sm font-semibold text-stone-800">แนวโน้มหนี้บัตร</h2>
			<p class="text-[11px] text-stone-400">ยอดหนี้ ณ สิ้นเดือน (บาท) — เส้นประคือคาดการณ์</p>
			<div
				class="mt-2 flex gap-1 rounded-lg bg-stone-100 p-0.5"
				role="group"
				aria-label="ช่วงเวลาย้อนหลัง"
			>
				{#each DEBT_PERIODS as p (p.months)}
					<button
						class="flex-1 rounded-md px-2 py-1 text-[11px] transition-colors {debtPeriod === p.months
							? 'bg-white font-semibold text-stone-800 shadow-sm'
							: 'text-stone-500'}"
						onclick={() => (debtPeriod = p.months)}
					>
						{p.label}
					</button>
				{/each}
			</div>
			{#if !debtLoaded}
				<div class="mt-2 h-48 animate-pulse rounded-xl bg-stone-100"></div>
			{:else if !hasDebtData}
				<p class="py-6 text-center text-sm text-stone-400">
					ยังไม่มีข้อมูลหนี้บัตรในช่วงนี้ — ผูกบัตรโดยตั้งวงเงินในแท็บบัญชีก่อน
				</p>
			{:else}
				<!-- ระหว่างสลับช่วงเวลา คงกราฟเดิมไว้แบบจางๆ แทน skeleton จะได้ไม่กระพริบ -->
				<div class="mt-2 h-48 transition-opacity {debtLoading ? 'opacity-50' : ''}">
					<canvas bind:this={debtCanvas}></canvas>
				</div>
				{#if debtTrend === 'down'}
					<p class="mt-2 text-xs text-green-700">
						หนี้กำลังลดลงเฉลี่ย {bahtWhole(-debtForecast.slope)}/เดือน{monthsToZero !== null &&
						monthsToZero <= 60
							? ` — ถ้าจ่ายเท่าเดิมต่อไป คาดว่าจะหมดในราว ${monthsToZero} เดือน`
							: ''}
					</p>
				{:else if debtTrend === 'up'}
					<p class="mt-2 text-xs text-red-600">
						หนี้กำลังเพิ่มขึ้นเฉลี่ย {bahtWhole(debtForecast.slope)}/เดือน
					</p>
				{:else}
					<p class="mt-2 text-xs text-stone-500">แนวโน้มหนี้ทรงตัว ไม่เพิ่มไม่ลด</p>
				{/if}
			{/if}
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
