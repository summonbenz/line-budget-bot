<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { ensureLiffReady, closeLiffWindow } from '$lib/liff';
	import {
		getTxEntry,
		updateTxEntry,
		deleteTxEntry,
		getTxSlipUrl,
		getCategories,
		UnauthorizedError
	} from '$lib/api';
	import { markDataChanged } from '$lib/store.svelte';
	import type { Category, TxEntry } from '$lib/types';

	const entryId = page.params.id!;

	let entry = $state<TxEntry | null>(null);
	let categories = $state<Category[]>([]);
	let error = $state('');
	let notFound = $state(false);

	// ฟอร์ม (เติมค่าจาก entry ตอนโหลดเสร็จ)
	let type = $state<'expense' | 'income'>('expense');
	let payee = $state('');
	let amountStr = $state('');
	let categoryId = $state('');
	let date = $state('');
	let time = $state('');

	// สลิปหลักฐาน — slipUrl ไว้แสดง (ของเดิมเป็น object URL / ของใหม่เป็น data URL)
	let slipUrl = $state<string | null>(null);
	let newSlipDataUrl = $state<string | null>(null);
	let slipRemoved = $state(false);

	let saving = $state(false);
	let deleting = $state(false);
	let savedFlash = $state(false);

	async function load() {
		try {
			await ensureLiffReady();
			const [e, catRes] = await Promise.all([getTxEntry(entryId), getCategories()]);
			entry = e;
			categories = catRes.categories;

			type = e.amount < 0 ? 'expense' : 'income';
			payee = e.payee ?? '';
			amountStr = String(Math.abs(e.amount) / 100);
			categoryId = e.categoryId ?? '';
			date = e.date;
			time = e.time ?? '12:00';

			if (e.hasSlip) slipUrl = await getTxSlipUrl(entryId);
		} catch (err) {
			console.error(err);
			if (err instanceof UnauthorizedError) {
				error = 'บัญชีนี้ไม่มีสิทธิ์เข้าดูข้อมูล';
			} else if (err instanceof Error && err.message.includes('404')) {
				notFound = true;
			} else {
				error = 'โหลดรายการไม่สำเร็จ ลองใหม่อีกครั้ง';
			}
		}
	}

	onMount(load);

	const categoryOptions = $derived(
		categories.filter((c) => (type === 'income' ? c.isIncome : !c.isIncome))
	);

	// เปลี่ยนประเภทแล้วหมวดเดิมใช้ไม่ได้ → เคลียร์ทิ้ง (เหมือนแท็บเพิ่มรายการ)
	$effect(() => {
		if (categoryId && !categoryOptions.some((c) => c.id === categoryId)) categoryId = '';
	});

	const amountValue = $derived(Number(amountStr) || 0);
	const canSave = $derived(!saving && !deleting && !!entry && amountValue > 0 && !!date && !!time);

	function pickSlip(ev: Event) {
		const file = (ev.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			newSlipDataUrl = reader.result as string;
			slipUrl = newSlipDataUrl;
			slipRemoved = false;
		};
		reader.readAsDataURL(file);
	}

	function removeSlip() {
		slipUrl = null;
		newSlipDataUrl = null;
		slipRemoved = true;
	}

	function closeOrHome() {
		if (!closeLiffWindow()) goto(`${base}/`);
	}

	async function save() {
		if (!canSave) return;
		saving = true;
		error = '';
		try {
			await updateTxEntry(entryId, {
				amount: type === 'expense' ? -amountValue : amountValue,
				payee: payee.trim() || undefined,
				categoryId: categoryId || null,
				date,
				time,
				...(newSlipDataUrl ? { slipBase64: newSlipDataUrl } : {}),
				...(slipRemoved && !newSlipDataUrl ? { removeSlip: true } : {})
			});
			markDataChanged();
			savedFlash = true;
			setTimeout(closeOrHome, 900); // โชว์ "บันทึกแล้ว" แวบนึงก่อนปิดหน้าต่าง
		} catch (err) {
			console.error(err);
			error =
				err instanceof UnauthorizedError
					? 'บัญชีนี้ไม่มีสิทธิ์แก้ไข'
					: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';
			saving = false;
		}
	}

	async function remove() {
		if (!entry || deleting || saving) return;
		if (!confirm('ลบรายการนี้ออกจากบัญชีเลยไหม?')) return;
		deleting = true;
		error = '';
		try {
			await deleteTxEntry(entryId);
			markDataChanged();
			closeOrHome();
		} catch (err) {
			console.error(err);
			error = 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง';
			deleting = false;
		}
	}
</script>

<div class="mx-auto min-h-dvh max-w-md">
	<header
		class="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur"
	>
		<h1 class="text-lg font-bold text-stone-900">แก้ไขรายการ</h1>
		{#if entry}
			<button
				type="button"
				class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500 text-white shadow-sm transition-colors active:bg-red-600 disabled:opacity-40"
				onclick={remove}
				disabled={deleting || saving}
				aria-label="ลบรายการ"
			>
				<svg
					viewBox="0 0 24 24"
					class="h-5 w-5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path
						d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m3 0l-.8 12.1a2 2 0 01-2 1.9H8.8a2 2 0 01-2-1.9L6 7m4 4v6m4-6v6"
					/>
				</svg>
			</button>
		{/if}
	</header>

	{#if notFound}
		<div class="flex items-center justify-center p-6 pt-20">
			<div class="w-full rounded-2xl bg-white p-6 text-center shadow-sm">
				<p class="text-3xl">🔍</p>
				<p class="mt-3 text-sm text-stone-600">ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)</p>
			</div>
		</div>
	{:else if !entry && !error}
		<div class="flex items-center justify-center pt-24">
			<div class="flex flex-col items-center gap-3 text-stone-400">
				<div
					class="h-8 w-8 animate-spin rounded-full border-[3px] border-stone-300 border-t-emerald-600"
				></div>
				<p class="text-sm">กำลังโหลด...</p>
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-4 px-4 pt-4 pb-10">
			{#if error}
				<p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
			{/if}

			{#if entry}
				<!-- รายละเอียด -->
				<label class="flex flex-col gap-1.5">
					<span class="text-sm font-semibold text-stone-700">รายละเอียด</span>
					<input
						type="text"
						class="rounded-xl border-none bg-white px-3.5 py-2.5 text-sm text-stone-800 shadow-sm outline-none placeholder:text-stone-400"
						placeholder="ร้านค้า / ผู้รับเงิน"
						bind:value={payee}
					/>
				</label>

				<!-- ประเภทรายการ -->
				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-semibold text-stone-700">ประเภทรายการ</span>
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
				</div>

				<!-- หมวด -->
				<label class="flex flex-col gap-1.5">
					<span class="text-sm font-semibold text-stone-700">หมวด</span>
					<select
						class="rounded-xl border-none bg-white px-3 py-2.5 text-sm shadow-sm outline-none {categoryId
							? 'text-stone-800'
							: 'text-stone-400'}"
						bind:value={categoryId}
					>
						<option value="">ไม่ระบุหมวด</option>
						{#each categoryOptions as cat (cat.id)}
							<option value={cat.id}>{cat.name}</option>
						{/each}
					</select>
				</label>

				<!-- จำนวนเงิน -->
				<label class="flex flex-col gap-1.5">
					<span class="text-sm font-semibold text-stone-700">จำนวนเงิน</span>
					<div class="flex items-center gap-2">
						<input
							type="text"
							inputmode="decimal"
							class="min-w-0 flex-1 rounded-xl border-none bg-white px-3.5 py-2.5 text-base font-semibold shadow-sm outline-none
							{type === 'expense' ? 'text-stone-900' : 'text-emerald-700'}"
							bind:value={amountStr}
						/>
						<span class="text-lg text-stone-400">฿</span>
					</div>
				</label>

				<!-- วันที่และเวลา -->
				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-semibold text-stone-700">วันที่และเวลา</span>
					<div class="grid grid-cols-[3fr_2fr] gap-2">
						<input
							type="date"
							class="rounded-xl border-none bg-white px-3.5 py-2.5 text-sm text-stone-800 shadow-sm outline-none"
							bind:value={date}
						/>
						<input
							type="time"
							class="rounded-xl border-none bg-white px-3.5 py-2.5 text-sm text-stone-800 shadow-sm outline-none"
							bind:value={time}
						/>
					</div>
					<p class="text-xs text-stone-400">บัญชี: {entry.accountName ?? '-'}</p>
				</div>

				<!-- หลักฐาน (สลิป/ใบเสร็จ) -->
				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-semibold text-stone-700">หลักฐาน</span>
					{#if slipUrl}
						<div class="relative overflow-hidden rounded-2xl bg-white shadow-sm">
							<img src={slipUrl} alt="สลิป/หลักฐาน" class="max-h-72 w-full object-contain" />
							<button
								type="button"
								class="absolute top-2 right-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white"
								onclick={removeSlip}
							>
								ลบรูป
							</button>
						</div>
					{:else}
						<label
							class="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 bg-white px-4 py-5 shadow-sm"
						>
							<span
								class="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"
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
									<rect x="3" y="5" width="18" height="14" rx="2" />
									<path d="M3 15l4.5-4.5L12 15l3-3 6 6M15.5 9.5h.01" />
								</svg>
							</span>
							<span class="flex flex-col">
								<span class="text-sm font-semibold text-stone-700">แนบสลิป/ใบเสร็จ</span>
								<span class="text-xs text-stone-400">ไม่บังคับ — เก็บไว้เป็นหลักฐาน</span>
							</span>
							<input type="file" accept="image/*" class="hidden" onchange={pickSlip} />
						</label>
					{/if}
				</div>

				<!-- บันทึก -->
				<button
					type="button"
					class="mt-2 rounded-2xl bg-emerald-600 py-3.5 text-base font-bold text-white shadow-md transition-colors active:bg-emerald-700 disabled:opacity-40"
					disabled={!canSave}
					onclick={save}
				>
					{#if savedFlash}
						บันทึกแล้ว ✓
					{:else if saving}
						กำลังบันทึก...
					{:else}
						บันทึก
					{/if}
				</button>
			{/if}
		</div>
	{/if}
</div>
