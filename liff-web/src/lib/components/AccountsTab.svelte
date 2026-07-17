<script lang="ts">
	import { getAccounts, setCardLimit, UnauthorizedError } from '$lib/api';
	import { appState, markDataChanged } from '$lib/store.svelte';
	import { baht, bahtWhole, nextDueDate } from '$lib/format';
	import type { Account } from '$lib/types';

	let { active }: { active: boolean } = $props();

	let accounts = $state<Account[]>([]);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let loadedVersion = -1;

	// ฟอร์มแก้บัตร (กดที่การ์ดเพื่อกาง) + ฟอร์มเพิ่มบัตรใหม่
	let expandedId = $state<string | null>(null);
	let editLimitValue = $state('');
	let editDueDayValue = $state('');
	let addingCard = $state(false);
	let addAccountId = $state('');
	let addLimitValue = $state('');
	let addDueDayValue = $state('');
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

	/** สัดส่วนวงเงินที่ใช้ไป 0-100 (เกินวงเงินก็ตัดที่ 100) */
	function usedPct(a: Account): number {
		if (!a.creditLimit || a.creditLimit <= 0) return 0;
		return Math.min((debt(a) / a.creditLimit) * 100, 100);
	}

	// ยอดรวมทุกใบ สำหรับมิเตอร์ใหญ่ด้านบน (นับเฉพาะใบที่ตั้งวงเงินแล้ว)
	const limitCards = $derived(cards.filter((a) => a.creditLimit != null && a.creditLimit > 0));
	const totalCardDebt = $derived(limitCards.reduce((s, a) => s + debt(a), 0));
	const totalCardLimit = $derived(limitCards.reduce((s, a) => s + (a.creditLimit ?? 0), 0));
	const totalUsedPct = $derived(
		totalCardLimit > 0 ? Math.min((totalCardDebt / totalCardLimit) * 100, 100) : 0
	);

	// สีวงกลมตัวย่อของแต่ละใบ — คงที่ต่อชื่อ (hash ตัวอักษร) ไม่สุ่มใหม่ทุกครั้ง
	const AVATAR_COLORS = [
		'bg-sky-600',
		'bg-orange-500',
		'bg-emerald-600',
		'bg-violet-600',
		'bg-rose-500',
		'bg-amber-500'
	];
	function avatarColor(name: string): string {
		let hash = 0;
		for (const ch of name) hash = (hash + ch.codePointAt(0)!) % 997;
		return AVATAR_COLORS[hash % AVATAR_COLORS.length];
	}

	// ---- แก้บัตร (กางจากการ์ด) ----
	function toggleExpand(a: Account) {
		if (expandedId === a.id) {
			expandedId = null;
			return;
		}
		expandedId = a.id;
		editLimitValue = a.creditLimit ? (a.creditLimit / 100).toString() : '';
		editDueDayValue = a.dueDay ? a.dueDay.toString() : '';
	}

	async function commitEdit(a: Account) {
		const limit = Number(editLimitValue.trim().replace(/,/g, ''));
		if (!Number.isFinite(limit) || limit < 0) return;
		const dueDay = parseDueDay(editDueDayValue);
		if (dueDay === undefined) return; // กรอกวันมาแต่ไม่ใช่ 1-31
		expandedId = null;
		await saveCard(a.id, limit, dueDay);
	}

	// ---- เพิ่มบัตรใหม่ (ผูกบัญชี Actual + ตั้งวงเงินครั้งแรก) ----
	async function commitAdd() {
		const value = Number(addLimitValue.trim().replace(/,/g, ''));
		if (!addAccountId || !Number.isFinite(value) || value <= 0) return;
		const dueDay = parseDueDay(addDueDayValue);
		if (dueDay === undefined) return;
		await saveCard(addAccountId, value, dueDay);
		addingCard = false;
		addAccountId = '';
		addLimitValue = '';
		addDueDayValue = '';
	}

	/** '' → null, '20' → 20, ค่าอื่นที่ไม่ใช่ 1-31 → undefined (ไม่ผ่าน) */
	function parseDueDay(raw: string): number | null | undefined {
		const s = raw.trim();
		if (s === '') return null;
		const n = Number(s);
		if (!Number.isInteger(n) || n < 1 || n > 31) return undefined;
		return n;
	}

	async function saveCard(accountId: string, creditLimitBaht: number, dueDay: number | null) {
		saving = true;
		error = '';
		try {
			await setCardLimit(accountId, creditLimitBaht, dueDay);
			markDataChanged(); // ให้ effect ด้านบน refetch — วงเงิน/สถานะบัตรเปลี่ยน
		} catch (err) {
			console.error(err);
			error = 'บันทึกวงเงินไม่สำเร็จ ลองใหม่อีกครั้ง';
		} finally {
			saving = false;
		}
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
					<div class="flex gap-2">
						<input
							type="text"
							inputmode="decimal"
							placeholder="วงเงิน (บาท)"
							class="min-w-0 flex-[2] rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400"
							bind:value={addLimitValue}
						/>
						<input
							type="text"
							inputmode="numeric"
							placeholder="วันครบกำหนด"
							class="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400"
							bind:value={addDueDayValue}
						/>
					</div>
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
				<!-- มิเตอร์รวมทุกใบ: ใช้ไปเท่าไรจากวงเงินรวม -->
				{#if totalCardLimit > 0}
					<div class="relative mt-3 overflow-hidden rounded-2xl bg-stone-100">
						<div
							class="absolute inset-y-0 left-0 rounded-2xl bg-teal-300/80"
							style="width: {totalUsedPct}%"
						></div>
						<div class="relative flex flex-col items-end px-4 py-3">
							<p class="tabular text-2xl font-bold text-stone-900">{baht(totalCardDebt)}</p>
							<p class="tabular text-[11px] text-stone-500">
								จากวงเงินรวม {baht(totalCardLimit)}
							</p>
						</div>
					</div>
				{/if}

				<!-- รายใบ: avatar + ชื่อ + วันครบกำหนด | หนี้ + แถบวงเงินคงเหลือ -->
				<ul class="mt-1 divide-y divide-stone-100">
					{#each cards as card (card.id)}
						{@const over = card.creditLimit != null && debt(card) > card.creditLimit}
						<li>
							<button
								type="button"
								class="flex w-full items-center gap-3 py-3 text-left active:bg-stone-50"
								onclick={() => toggleExpand(card)}
							>
								<span
									class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold text-white {avatarColor(
										card.name
									)}"
								>
									{card.name.trim().charAt(0).toUpperCase()}
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-semibold text-stone-800">
										{card.name}
									</span>
									{#if card.dueDay}
										<span class="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-600">
											<svg
												viewBox="0 0 24 24"
												class="h-3 w-3"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<circle cx="12" cy="12" r="9" />
												<path d="M12 7v5l3 2" />
											</svg>
											{nextDueDate(card.dueDay)}
										</span>
									{:else}
										<span class="mt-0.5 block text-[11px] text-stone-400">แตะเพื่อตั้งค่า</span>
									{/if}
								</span>
								<span class="flex shrink-0 flex-col items-end gap-1">
									<span
										class="tabular text-lg leading-none font-bold {over
											? 'text-red-600'
											: 'text-stone-900'}"
									>
										{baht(debt(card))}
									</span>
									{#if card.creditLimit != null && card.creditLimit > 0}
										<span class="relative block h-5 w-32 overflow-hidden rounded-full bg-stone-100">
											<span
												class="absolute inset-y-0 left-0 rounded-full {over
													? 'bg-red-400'
													: 'bg-teal-300'}"
												style="width: {usedPct(card)}%"
											></span>
											<span
												class="tabular relative flex h-full items-center justify-end pr-2 text-[10px] font-medium {remaining(
													card
												) < 0
													? 'text-red-600'
													: 'text-stone-600'}"
											>
												{baht(remaining(card))}
											</span>
										</span>
									{:else}
										<span class="text-[10px] text-stone-400">ยังไม่ตั้งวงเงิน</span>
									{/if}
								</span>
							</button>

							{#if expandedId === card.id}
								<div class="mb-3 space-y-2 rounded-xl bg-stone-50 p-3">
									<div class="flex gap-2">
										<label class="min-w-0 flex-[2] text-[11px] text-stone-500">
											วงเงิน (บาท)
											<input
												type="text"
												inputmode="decimal"
												class="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none"
												bind:value={editLimitValue}
											/>
										</label>
										<label class="min-w-0 flex-1 text-[11px] text-stone-500">
											วันครบกำหนด (1-31)
											<input
												type="text"
												inputmode="numeric"
												class="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none"
												bind:value={editDueDayValue}
											/>
										</label>
									</div>
									<div class="flex gap-2">
										<button
											type="button"
											class="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-40"
											disabled={saving}
											onclick={() => commitEdit(card)}
										>
											บันทึก
										</button>
										<button
											type="button"
											class="flex-1 rounded-lg bg-stone-200 py-2 text-sm font-medium text-stone-600 active:bg-stone-300"
											onclick={() => (expandedId = null)}
										>
											ยกเลิก
										</button>
									</div>
								</div>
							{/if}
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
