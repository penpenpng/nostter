<script lang="ts">
	import { nip19 } from 'nostr-tools';
	import { Mute } from '$lib/Mute';
	import { pubkey, muteEventIds, writeRelays } from '../../stores/Author';
	import { pool } from '../../stores/Pool';
	import IconTrash from '@tabler/icons-svelte/dist/svelte/icons/IconTrash.svelte';

	let unmuting = false;

	const mute = new Mute($pubkey, $pool, $writeRelays);

	async function unmute(eventId: string) {
		console.log('[unmute event]', eventId);

		unmuting = true;

		try {
			await mute.unmutePrivate('e', eventId);
		} catch (error) {
			alert('Failed to unmute.');
		}

		unmuting = false;
	}
</script>

<h4>Muted Threads and Channels</h4>

<ul>
	{#each $muteEventIds as eventId}
		<li>
			<a href="/{nip19.neventEncode({ id: eventId })}">
				<span>{nip19.neventEncode({ id: eventId }).slice(0, 'nevent1'.length + 7)}</span>
			</a>
			<button class="clear" disabled={unmuting} on:click={() => unmute(eventId)}>
				<IconTrash size={18} />
			</button>
		</li>
	{/each}
</ul>

<style>
	button {
		color: var(--accent-gray);
	}
</style>
