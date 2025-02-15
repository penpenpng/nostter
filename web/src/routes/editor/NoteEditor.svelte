<script lang="ts">
	import { createEventDispatcher, onMount, tick } from 'svelte';
	import { Kind, nip19, type Event as NostrEvent } from 'nostr-tools';
	import { rxNostr } from '$lib/timelines/MainTimeline';
	import { NoteComposer } from '$lib/NoteComposer';
	import { channelIdStore, Channel } from '$lib/Channel';
	import { Content } from '$lib/Content';
	import { cachedEvents, channelMetadataEvents } from '$lib/cache/Events';
	import { EventItem } from '$lib/Items';
	import { openNoteDialog, replyTo, quotes, intentContent } from '../../stores/NoteDialog';
	import { pubkey, rom } from '../../stores/Author';
	import { userEvents } from '../../stores/UserEvents';
	import type { UserEvent } from '../types';
	import { customEmojiTags } from '../../stores/CustomEmojis';
	import IconSend from '@tabler/icons-svelte/dist/svelte/icons/IconSend.svelte';
	import Note from '../timeline/Note.svelte';
	import ChannelTitle from '../parts/ChannelTitle.svelte';
	import EmojiPickerSlide from './EmojiPickerSlide.svelte';
	import CustomEmoji from '../content/CustomEmoji.svelte';
	import ContentWarning from './ContentWarning.svelte';

	export function clear(): void {
		console.log('[note editor clear]');
		$openNoteDialog = false;
		content = '';
		pubkeys.clear();
		$replyTo = undefined;
		$quotes = [];
		exitComplement();
		emojiTags = [];
		contentWarningReason = undefined;
	}

	export function isAutocompleting(): boolean {
		return autocompleting;
	}

	let content = '';
	let posting = false;
	let complementStart = -1;
	let complementEnd = -1;
	let complementUserEvents: UserEvent[] = [];
	let selectedCustomEmojis = new Map<string, string>();
	let channelEvent: NostrEvent | undefined;
	let emojiTags: string[][] = [];
	let autocompleting = false;
	let pubkeys = new Set<string>();
	let contentWarningReason: string | undefined;

	let textarea: HTMLTextAreaElement;
	let article: HTMLElement;

	const dispatch = createEventDispatcher();

	onMount(async () => {
		console.log('[note editor on mount]', textarea, article);
		const { default: Tribute } = await import('tributejs');

		const tribute = new Tribute({
			trigger: ':',
			positionMenu: false,
			values: $customEmojiTags.map(([, shortcode, imageUrl]) => {
				return {
					shortcode,
					imageUrl
				};
			}),
			lookup: 'shortcode',
			fillAttr: 'shortcode',
			menuContainer: article,
			menuItemTemplate: (item) =>
				`<img src="${item.original.imageUrl}" alt=":${item.original.shortcode}:"><span>:${item.original.shortcode}:</span>`,
			selectTemplate: (item) => `:${item.original.shortcode}:`,
			noMatchTemplate: () =>
				'<a href="https://emojis-iota.vercel.app/" target="_blank" rel="noopener noreferrer">Add custom emojis</a>'
		});
		tribute.attach(textarea);
		console.debug('[tribute]', tribute);

		customEmojiTags.subscribe((tags) => {
			console.debug('[custom emojis updated]', tags);
			tribute.append(
				0,
				tags.map(([, shortcode, imageUrl]) => {
					return {
						shortcode,
						imageUrl
					};
				})
			);
		});

		textarea.addEventListener('tribute-replaced', (e: any) => {
			console.debug('[tribute replaced]', e);
			selectedCustomEmojis.set(
				e.detail.item.original.shortcode,
				e.detail.item.original.imageUrl
			);
			console.timeLog('tribute');
		});

		textarea.addEventListener('tribute-active-true', (e) => {
			console.debug('[tribute active true]', e);
			autocompleting = true;
			console.time('tribute');
		});

		textarea.addEventListener('tribute-active-false', (e) => {
			console.debug('[tribute active false]', e);
			setTimeout(() => {
				console.log('[tribute closeable]');
				autocompleting = false;
				console.timeEnd('tribute');
			}, 200);
		});
	});

	channelIdStore.subscribe((channelId) => {
		if (channelId !== undefined) {
			channelEvent = channelMetadataEvents.get(channelId) ?? cachedEvents.get(channelId);
		} else {
			channelEvent = undefined;
		}
	});

	// FIXME: Change trigger
	openNoteDialog.subscribe(async (open) => {
		console.log('[open]', open);
		if (open) {
			if ($quotes.length > 0) {
				content =
					'\n' + $quotes.map((event) => `nostr:${nip19.noteEncode(event.id)}`).join('\n');
			}

			await tick();
			console.log(textarea, textarea.selectionStart);
			textarea.setSelectionRange(0, 0);
			textarea.focus();
		}
	});

	intentContent.subscribe((value) => {
		console.log('[content override]');

		content = value;
		value = '';
	});

	async function submitFromKeyboard(event: KeyboardEvent) {
		console.debug(`[${event.type}]`, event.code, event.key, event.ctrlKey, event.metaKey);
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			await postNote();
		}
	}

	async function onInput(inputEvent: Event) {
		const { selectionStart, selectionEnd } = textarea;
		console.debug(
			'[complement input]',
			inputEvent,
			content,
			complementStart,
			selectionStart,
			selectionEnd
		);
		if (!(inputEvent instanceof InputEvent)) {
			console.warn('[complement input type]', typeof inputEvent);
			return;
		}

		if (
			selectionStart === selectionEnd &&
			selectionStart > 0 &&
			content.lastIndexOf('@', selectionStart) >= 0
		) {
			complementStart = content.lastIndexOf('@', selectionStart);
		} else if (content.lastIndexOf('@', selectionStart) < 0) {
			exitComplement();
		}

		if (complementStart >= 0) {
			complementEnd = selectionEnd;
			const complementName = content.slice(complementStart + 1, selectionStart).toLowerCase();
			const max = 5;
			complementUserEvents = [...$userEvents]
				.filter(
					([, e]) =>
						e.user?.name?.toLowerCase().startsWith(complementName) ||
						e.user?.display_name?.toLowerCase().startsWith(complementName)
				)
				.map(([, e]) => e)
				.slice(0, max);
			if (complementUserEvents.length < max) {
				complementUserEvents.push(
					...[...$userEvents]
						.filter(
							([, e]) =>
								e.user?.name?.toLowerCase().includes(complementName) ||
								e.user?.display_name?.toLowerCase().includes(complementName)
						)
						.filter(([p]) => !complementUserEvents.some((x) => x.pubkey === p))
						.map(([, e]) => e)
						.slice(0, max - complementUserEvents.length)
				);
			}
			if (complementUserEvents.length < max) {
				// TODO: fetch
			}
			console.debug(
				'[complement]',
				complementName,
				complementUserEvents.map((x) => `@${x.user.name}, ${x.pubkey}`)
			);

			// Exit if not found
			if (complementUserEvents.length === 0) {
				exitComplement();
			}
		}
	}

	async function replaceComplement(event: UserEvent) {
		console.debug('[replace complement]', content, complementStart, complementEnd);
		const beforeCursor =
			content.substring(0, complementStart) + `nostr:${nip19.npubEncode(event.pubkey)} `;
		const afterCursor = content.substring(complementEnd);
		content = beforeCursor + afterCursor;
		const cursor = beforeCursor.length;
		console.debug('[replaced complement]', content, cursor);
		exitComplement();
		await tick();
		textarea.setSelectionRange(cursor, cursor);
		textarea.focus();
	}

	function exitComplement() {
		complementStart = -1;
		complementEnd = -1;
		complementUserEvents = [];
	}

	function onEmojiPick({ detail: emoji }: { detail: any }) {
		console.log('[emoji pick]', emoji);
		const shortcode = emoji.id.replaceAll('+', '_');
		content += emoji.native ?? `:${shortcode}:`;
		if (
			emoji.native === undefined &&
			emoji.src !== undefined &&
			!emojiTags.some(([, s]) => s === shortcode)
		) {
			emojiTags.push(['emoji', shortcode, emoji.src]);
			emojiTags = emojiTags;
		}
	}

	async function postNote() {
		if (content === '') {
			console.log('Content is empty');
			return;
		}

		if ($rom) {
			console.error('Readonly');
			return;
		}

		if (posting) {
			console.error('Posting');
			return;
		}

		posting = true;

		let tags: string[][] = [];

		const noteComposer = new NoteComposer();
		const event = await noteComposer.compose(
			$channelIdStore !== undefined || $replyTo?.event?.kind === Kind.ChannelMessage
				? Kind.ChannelMessage
				: Kind.Text,
			Content.replaceNip19(content),
			tags,
			$replyTo,
			emojiTags,
			$channelIdStore,
			pubkeys,
			selectedCustomEmojis,
			contentWarningReason
		);

		console.log('[rx-nostr send to]', rxNostr.getAllRelayState());
		const sendToRelays = rxNostr
			.getRelays()
			.filter(({ write }) => write)
			.map(({ url }) => url);
		const sentRelays = new Map<string, boolean>();
		rxNostr.send(event).subscribe({
			next: (packet) => {
				console.log('[rx-nostr send next]', packet);
				sentRelays.set(packet.from, packet.ok);
				if (packet.ok) {
					posting = false;
					dispatch('sent');
				}
			},
			complete: () => {
				console.log('[rx-nostr send complete]');
			},
			error: (error) => {
				console.error(
					'[rx-nostr send error]',
					error,
					sendToRelays.filter((url) => !sentRelays.has(url))
				);
				posting = false;
			}
		});
	}
</script>

<article bind:this={article}>
	{#if channelEvent !== undefined}
		<ChannelTitle channelMetadata={Channel.parseMetadata(channelEvent)} />
	{/if}
	{#if $replyTo}
		<Note item={$replyTo} readonly={true} />
	{/if}
	<form on:submit|preventDefault={postNote}>
		<textarea
			placeholder="What's happening?"
			bind:value={content}
			bind:this={textarea}
			on:keydown={submitFromKeyboard}
			on:keyup|stopPropagation={() => console.debug}
			on:input={onInput}
		/>
		<input id="send" type="submit" disabled={!pubkey || posting} />
		<label for="send"><IconSend size={30} /></label>
	</form>
	<div class="options">
		<div class="emoji-picker">
			<EmojiPickerSlide on:pick={onEmojiPick} />
		</div>
		<div class="content-warning">
			<ContentWarning bind:reason={contentWarningReason} />
		</div>
	</div>
	{#if $quotes.length > 0}
		{#each $quotes as quote}
			<Note item={new EventItem(quote)} readonly={true} />
		{/each}
	{/if}
	{#if complementStart >= 0}
		<ul>
			{#each complementUserEvents as event}
				<!-- svelte-ignore a11y-click-events-have-key-events -->
				<li on:click|stopPropagation={async () => await replaceComplement(event)}>
					<span>{event.user.display_name ?? ''}</span>
					<span>@{event.user.name ?? event.user.display_name}</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if emojiTags.length > 0}
		<ul>
			{#each emojiTags as tag}
				<li>
					<span>:{tag[1]}:</span>
					<CustomEmoji text={tag[1]} url={tag[2]} />
				</li>
			{/each}
		</ul>
	{/if}
</article>

<style>
	textarea {
		width: 100%;
		height: 4em;
	}

	label {
		display: block;
		margin-left: auto;
		width: 30px;
	}

	input[type='submit'] {
		display: none;
	}

	input[type='submit']:disabled + label {
		color: lightgray;
	}

	label {
		height: 30px;
	}

	ul {
		list-style: none;
		padding: 0;
	}

	.options {
		margin-top: -30px;

		display: flex;
		flex-direction: row;
	}

	:global(.tribute-container ul) {
		list-style: none;
		padding: 0;

		background-color: white;
		max-height: 10rem;
		overflow: auto;
	}

	:global(.tribute-container li.highlight) {
		background-color: lightgray;
	}

	:global(.tribute-container img) {
		height: 1.5rem;
		margin: 0 0.5rem;
	}
</style>
