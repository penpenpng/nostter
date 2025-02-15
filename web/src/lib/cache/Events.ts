import type { Event } from 'nostr-tools';

type id = string;
type pubkey = string;
// <event.id, event>
export const cachedEvents = new Map<id, Event>();
// <pubkey, event>
export const metadataEvents = new Map<pubkey, Event>();
// <root-id, event>
export const channelMetadataEvents = new Map<id, Event>();
