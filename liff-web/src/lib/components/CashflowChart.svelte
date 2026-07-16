<script lang="ts">
	import type { CashflowMonth } from '$lib/types';

	let { months }: { months: CashflowMonth[] } = $props();

	let canvas = $state<HTMLCanvasElement | undefined>(undefined);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let chart: any;

	function draw() {
		if (!canvas || !window.Chart) return;

		chart?.destroy();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ChartCtor = window.Chart as any;
		chart = new ChartCtor(canvas, {
			type: 'line',
			data: {
				labels: months.map((m) => m.month),
				datasets: [
					{
						label: 'หนี้รวม',
						data: months.map((m) => m.totalDebt / 100),
						borderColor: '#D85A30',
						backgroundColor: 'rgba(216, 90, 48, 0.1)',
						tension: 0.3,
						fill: true
					}
				]
			},
			options: {
				plugins: { legend: { display: false } },
				scales: { y: { beginAtZero: true } }
			}
		});
	}

	$effect(() => {
		months;
		draw();
		return () => chart?.destroy();
	});
</script>

<canvas bind:this={canvas} class="rounded-xl border border-gray-200 bg-white p-2" height="220"
></canvas>
