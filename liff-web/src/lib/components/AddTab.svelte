<script lang="ts">
	import { addTransaction, getAccounts, getCategories, UnauthorizedError } from '$lib/api';
	import { markDataChanged } from '$lib/store.svelte';
	import { localDateString } from '$lib/format';
	import type { Account, Category } from '$lib/types';

	let { active }: { active: boolean } = $props();

	let accounts = $state<Account[]>([]);
	let categories = $state<Category[]>([]);
	let loaded = $state(false);
	let error = $state('');

	let type = $state<'expense' | 'income'>('expense');
	let amountStr = $state('');
	let payee = $state('');
	let accountId = $state('');
	let categoryId = $state('');
	let notes = $state('');
	let saving = $state(false);
	let savedFlash = $state(false);

	async function load() {
		try {
			const [accRes, catRes] = await Promise.all([getAccounts(), getCategories()]);
			accounts = accRes.accounts.filter((a) => !a.offBudget);
			categories = catRes.categories;
			if (!accountId && accounts.length > 0) accountId = accounts[0].id;
			loaded = true;
		} catch (err) {
			console.error(err);
			error =
				err instanceof UnauthorizedError
					? 'บัญชีนี้ไม่มีสิทธิ์เข้าดูข้อมูล'
					: 'โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง';
		}
	}

	$effect(() => {
		if (active && !loaded && !error) load();
	});

	const categoryOptions = $derived(
		categories.filter((c) => (type === 'income' ? c.isIncome : !c.isIncome))
	);

	// เปลี่ยนประเภทแล้วหมวดเดิมใช้ไม่ได้ → เคลียร์ทิ้ง
	$effect(() => {
		if (categoryId && !categoryOptions.some((c) => c.id === categoryId)) categoryId = '';
	});

	const displayAmount = $derived.by(() => {
		if (!amountStr) return '0';
		const [int, dec] = amountStr.split('.');
		const formatted = Number(int || '0').toLocaleString('th-TH');
		return dec !== undefined ? `${formatted}.${dec}` : formatted;
	});

	const amountValue = $derived(amountStr ? Number(amountStr) : 0);
	const canSave = $derived(!saving && loaded && amountValue > 0 && !!accountId);

	function press(key: string) {
		if (key === '.') {
			if (amountStr.includes('.')) return;
			amountStr = amountStr === '' ? '0.' : amountStr + '.';
			return;
		}
		const [int, dec] = amountStr.split('.');
		if (dec !== undefined && dec.length >= 2) return; // สตางค์ 2 หลักพอ
		if (dec === undefined && int.length >= 9) return;
		if (amountStr === '0') amountStr = key;
		else amountStr += key;
	}

	function backspace() {
		amountStr = amountStr.slice(0, -1);
	}

	async function save() {
		if (!canSave) return;
		saving = true;
		error = '';
		try {
			await addTransaction({
				accountId,
				amount: type === 'expense' ? -amountValue : amountValue,
				payee: payee.trim() || undefined, // Actual สร้าง payee ใหม่ให้อัตโนมัติถ้ายังไม่มี
				categoryId: categoryId || undefined,
				notes: notes.trim() || undefined,
				date: localDateString(new Date())
			});
			markDataChanged();
			amountStr = '';
			payee = '';
			notes = '';
			savedFlash = true;
			setTimeout(() => (savedFlash = false), 1800);
		} catch (err) {
			console.error(err);
			error = 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';
		} finally {
			saving = false;
		}
	}

	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];
</script>

<header
	class="sticky top-0 z-10 border-b border-stone-200 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur"
>
	<h1 class="text-lg font-bold text-stone-900">เพิ่มรายการ</h1>
</header>

<div class="flex flex-col gap-3 px-4 pt-3">
	{#if error}
		<p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
	{/if}

	<!-- สลับ รายจ่าย/รายรับ -->
	<div class="grid grid-cols-2 gap-1 rounded-full bg-stone-200 p-1">
		<button
			type="button"
			class="rounded-full py-2 text-sm font-semibold transition-colors
			{type === 'expense' ? 'bg-white text-red-600 shadow-sm' : 'text-stone-500'}"
			onclick={() => (type = 'expense')}
		>
			รายจ่าย
		</button>
		<button
			type="button"
			class="rounded-full py-2 text-sm font-semibold transition-colors
			{type === 'income' ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500'}"
			onclick={() => (type = 'income')}
		>
			รายรับ
		</button>
	</div>

	<!-- จำนวนเงิน -->
	<div class="rounded-2xl bg-white px-4 py-5 text-center shadow-sm">
		<p
			class="tabular text-4xl font-bold {type === 'expense'
				? 'text-stone-900'
				: 'text-emerald-700'}"
		>
			<span class="align-top text-xl text-stone-400">฿</span>{displayAmount}
		</p>
		{#if savedFlash}
			<p class="mt-1 text-xs font-medium text-emerald-600">บันทึกแล้ว ✓</p>
		{:else}
			<p class="mt-1 text-xs text-stone-400">{type === 'expense' ? 'จ่ายออก' : 'รับเข้า'}วันนี้</p>
		{/if}
	</div>

	<!-- รายละเอียด -->
	<div class="grid grid-cols-2 gap-2">
		<select
			class="col-span-1 rounded-xl border-none bg-white px-3 py-2.5 text-sm text-stone-800 shadow-sm outline-none"
			bind:value={accountId}
		>
			{#if accounts.length === 0}
				<option value="" disabled>ไม่มีบัญชี</option>
			{/if}
			{#each accounts as account (account.id)}
				<option value={account.id}>{account.name}</option>
			{/each}
		</select>
		<select
			class="col-span-1 rounded-xl border-none bg-white px-3 py-2.5 text-sm shadow-sm outline-none {categoryId
				? 'text-stone-800'
				: 'text-stone-400'}"
			bind:value={categoryId}
		>
			<option value="">ไม่ระบุหมวด</option>
			{#each categoryOptions as cat (cat.id)}
				<option value={cat.id}>{cat.name}</option>
			{/each}
		</select>
		<input
			type="text"
			placeholder={type === 'expense' ? 'ร้านค้า / ผู้รับเงิน' : 'ที่มาของเงิน'}
			class="col-span-2 rounded-xl border-none bg-white px-3.5 py-2.5 text-sm text-stone-800 shadow-sm outline-none placeholder:text-stone-400"
			bind:value={payee}
		/>
		<input
			type="text"
			placeholder="โน้ต (ไม่บังคับ)"
			class="col-span-2 rounded-xl border-none bg-white px-3.5 py-2.5 text-sm text-stone-800 shadow-sm outline-none placeholder:text-stone-400"
			bind:value={notes}
		/>
	</div>

	<!-- numpad -->
	<div class="grid grid-cols-3 gap-2">
		{#each keys as key (key)}
			<button
				type="button"
				class="h-13 rounded-xl bg-white text-xl font-semibold text-stone-800 shadow-sm transition-colors active:bg-stone-200"
				onclick={() => press(key)}
			>
				{key}
			</button>
		{/each}
		<button
			type="button"
			class="h-13 rounded-xl bg-white text-stone-500 shadow-sm transition-colors active:bg-stone-200"
			onclick={backspace}
			aria-label="ลบตัวเลข"
		>
			<svg
				viewBox="0 0 24 24"
				class="mx-auto h-6 w-6"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path
					d="M9 4.5h10A1.5 1.5 0 0120.5 6v12a1.5 1.5 0 01-1.5 1.5H9L2.5 12 9 4.5zM12 9.5l5 5m0-5l-5 5"
				/>
			</svg>
		</button>
	</div>

	<button
		type="button"
		class="rounded-2xl py-3.5 text-base font-bold text-white shadow-md transition-colors disabled:opacity-40
		{type === 'expense' ? 'bg-red-500 active:bg-red-600' : 'bg-emerald-600 active:bg-emerald-700'}"
		disabled={!canSave}
		onclick={save}
	>
		{saving ? 'กำลังบันทึก...' : type === 'expense' ? 'บันทึกรายจ่าย' : 'บันทึกรายรับ'}
	</button>
</div>
