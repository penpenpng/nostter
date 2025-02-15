<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { error } from '@sveltejs/kit';
	import { nip19, Kind } from 'nostr-tools';
	import { author, readRelays } from '../../stores/Author';
	import { pool } from '../../stores/Pool';
	import TimelineView from '../TimelineView.svelte';
	import type { EventPointer } from 'nostr-tools/lib/nip19';
	import { Api } from '$lib/Api';
	import { referTags } from '$lib/EventHelper';
	import type { EventItem, Metadata } from '$lib/Items';
	import Counter from './Counter.svelte';
	import ProfileIconList from './ProfileIconList.svelte';
	import { chronologicalItem } from '$lib/Constants';
	import { setContext } from 'svelte';
	import MuteButton from '../action/MuteButton.svelte';

	let item: EventItem | undefined;
	let items: EventItem[] = [];
	let eventId = '';
	let rootId: string | undefined;
	let relays: string[] = [];

	let repostEvents: EventItem[] | undefined;
	let reactionEvents: EventItem[] | undefined;

	$: repostMetadataList =
		repostEvents !== undefined
			? repostEvents.map((x) => x.metadata).filter((x): x is Metadata => x !== undefined)
			: [];
	$: reactionMetadataList =
		reactionEvents !== undefined
			? reactionEvents.map((x) => x.metadata).filter((x): x is Metadata => x !== undefined)
			: [];

	setContext('timeline-config', {
		fullMenu: true
	});

	afterNavigate(async () => {
		console.log('[note page]');

		clear();

		const slug = $page.params.note;
		console.log(slug);
		try {
			const { type, data } = nip19.decode(slug);
			console.log('[decode]', type, data);

			switch (type) {
				case 'note': {
					eventId = data as string;
					break;
				}
				case 'nevent': {
					const pointer = data as EventPointer;
					eventId = pointer.id;
					relays = pointer.relays ?? [];
					break;
				}
				default: {
					throw error(500);
				}
			}
		} catch (e) {
			console.error('[decode error]', e);
			throw error(404);
		}

		const api = new Api($pool, [...new Set([...$readRelays, ...relays])]);
		item = await api.fetchEventItemById(eventId);
		if (item === undefined) {
			throw error(404);
		}
		items.push(item);
		items = items;

		const relatedEvents = await api.fetchEventItems([
			{
				'#e': [eventId]
			}
		]);
		relatedEvents.sort(chronologicalItem);
		console.log('[#e events]', relatedEvents);

		const repliedEvents = relatedEvents.filter(
			(x) => x.event.kind === Kind.Text && x.event.id !== eventId
		);
		repostEvents = relatedEvents.filter((x) => Number(x.event.kind) === 6);
		reactionEvents = relatedEvents.filter((x) => x.event.kind === Kind.Reaction);
		console.log(repliedEvents, repostEvents, reactionEvents);

		const { root, reply } = referTags(item.event);
		rootId = root?.at(1);
		let replyId = reply?.at(1);
		console.log(rootId, replyId);

		let i = 0;
		while (replyId !== undefined) {
			const replyToEvent = await api.fetchEventItemById(replyId);
			if (replyToEvent !== undefined) {
				items.unshift(replyToEvent);
				items = items;
				replyId = referTags(replyToEvent.event).reply?.at(1);
			}
			i++;
			if (i > 20) {
				break;
			}
		}

		if (rootId !== undefined && !items.some((x) => x.event.id === rootId) && i <= 20) {
			const rootEvent = await api.fetchEventItemById(rootId);
			if (rootEvent !== undefined) {
				items.unshift(rootEvent);
				items = items;
			}
		}

		items.push(...repliedEvents);
		items = items;
	});

	function clear() {
		items = [];
		repostEvents = undefined;
		reactionEvents = undefined;
	}
</script>

<svelte:head>
	<title>nostter - note</title>
</svelte:head>

<h1>note</h1>

<TimelineView
	{items}
	readonly={false}
	focusEventId={eventId}
	load={async () => console.debug()}
	showLoading={false}
/>

{#if repostEvents !== undefined}
	<Counter label={'Reposts'} count={repostEvents.length} />
	<ProfileIconList metadataList={repostMetadataList} />
{/if}
{#if reactionEvents !== undefined}
	<Counter label={'Reactions'} count={reactionEvents.length} />
	<ProfileIconList metadataList={reactionMetadataList} />
{/if}
{#if $author !== undefined && item !== undefined}
	<div class="mute">
		<MuteButton tagName="e" tagContent={rootId === undefined ? eventId : rootId} />
		<span>Mute this thread</span>
	</div>
	<div class="mute">
		<MuteButton tagName="p" tagContent={item.event.pubkey} />
		<span>Mute @{item.metadata?.content?.name}</span>
	</div>
{/if}

<style>
	.mute {
		margin-top: 16px;
		display: flex;
		flex-direction: row;
	}

	.mute span {
		margin-left: 0.5rem;
	}
</style>
