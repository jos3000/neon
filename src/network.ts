import Peer, { DataConnection } from 'peerjs';

type ClientConnections = DataConnection[];

// How often buffered messages are flushed onto the wire. Everything produced in
// between is coalesced into a single send, so this is also the game's natural
// send rate — MainScene matches its snapshot cadence to it (see the import of
// this constant there) so a flush carries exactly one position snapshot instead
// of a redundant backlog of them.
export const NET_SEND_INTERVAL_MS = 33;

// The data channel is reliable + ordered, so anything queued behind a congested
// channel delays everything sent after it. peerjs only stops buffering at 8MB,
// which is many seconds of backlog on a real link — long before that the game is
// unplayable, and it never recovers because we keep producing at a fixed rate.
// Once the channel is this far behind, drop messages marked `droppable`
// (position snapshots — the next one supersedes them anyway) and keep only the
// ones that carry state changes.
const MAX_BUFFERED_BYTES = 64 * 1024;

interface SendOptions {
  /** Safe to skip if the channel is congested; the next one replaces it. */
  droppable?: boolean;
}

type SendMessage<MessageFormat> = (msg: MessageFormat, options?: SendOptions) => void;

interface BufferedMessage<MessageFormat> {
  message: MessageFormat;
  droppable: boolean;
}

interface StartEvent<MessageFormat> {
  type: 'start';
  id: string;
  sendMessage: SendMessage<MessageFormat>;
}

interface MessageEvent<MessageFormat> {
  type: 'message';
  id: string;
  message: MessageFormat[];
}

interface DisconnectedEvent {
  type: 'disconnected';
  id: string;
}

interface ConnectedEvent {
  type: 'connected';
  id: string;
}

type HostEvent<HostMessageFormat, ClientMessageFormat> =
  | StartEvent<HostMessageFormat>
  | MessageEvent<ClientMessageFormat>
  | DisconnectedEvent
  | ConnectedEvent;

type ClientEvent<HostMessageFormat, ClientMessageFormat> =
  StartEvent<ClientMessageFormat> | MessageEvent<HostMessageFormat> | DisconnectedEvent;

// `dataChannel` isn't part of peerjs's public typings, but it is the live
// RTCDataChannel and its bufferedAmount is our only visibility into how far
// behind the link is. Treat an unavailable channel as "not congested".
function bufferedAmount(connection: DataConnection): number {
  return (
    (connection as unknown as { dataChannel?: RTCDataChannel }).dataChannel?.bufferedAmount ?? 0
  );
}

// Sends one batch to one connection, shedding droppable messages when that
// particular connection is congested — congestion is per-peer, so a single slow
// client must not degrade what everyone else receives.
function sendBatch<MessageFormat>(
  connection: DataConnection,
  buffer: BufferedMessage<MessageFormat>[]
) {
  if (!connection.open) return;

  const congested = bufferedAmount(connection) > MAX_BUFFERED_BYTES;
  const payload = congested
    ? buffer.filter((entry) => !entry.droppable).map((entry) => entry.message)
    : buffer.map((entry) => entry.message);

  if (payload.length === 0) return;
  connection.send(payload);
}

export function createOrJoinPeerId<HostMessageFormat, ClientMessageFormat>(
  peerId: string,
  hostCallback: (event: HostEvent<HostMessageFormat, ClientMessageFormat>) => void,
  clientCallback: (event: ClientEvent<HostMessageFormat, ClientMessageFormat>) => void
): void {
  const hostPeer = new Peer(peerId);

  const connections: ClientConnections = [];

  let hostBuffer: BufferedMessage<HostMessageFormat>[] = [];
  let hostFlushInterval: number | undefined;

  function sendHostMessage(message: HostMessageFormat, options?: SendOptions) {
    hostBuffer.push({ message, droppable: options?.droppable === true });
  }

  function flushHostMessages() {
    if (hostBuffer.length === 0) {
      return;
    }
    // Connections are only added to `connections` once their data channel is
    // open (see conn.on('open', ...) below), so it's always safe to send here.
    for (const connection of connections) {
      sendBatch(connection, hostBuffer);
    }
    hostBuffer = [];
  }

  // periodically flush host messages to connected clients
  hostFlushInterval = setInterval(flushHostMessages, NET_SEND_INTERVAL_MS);

  hostPeer.on('open', () => {
    console.log(`Hosting with peer ID: ${peerId}`);
    hostCallback({ type: 'start', sendMessage: sendHostMessage, id: peerId });
  });

  hostPeer.on('connection', (conn: DataConnection) => {
    conn.on('open', () => {
      console.log('Client connected:', conn.peer);
      connections.push(conn);
      hostCallback({
        type: 'connected',
        id: conn.peer,
      });
    });
    conn.on('data', (data: ClientMessageFormat[]) => {
      hostCallback({
        type: 'message',
        id: conn.peer,
        message: data,
      });
    });
    conn.on('close', () => {
      // remove the dead connection
      const idx = connections.indexOf(conn);
      if (idx > -1) connections.splice(idx, 1);
      hostCallback({
        type: 'disconnected',
        id: conn.peer,
      });
    });
    conn.on('error', (err: unknown) => {
      console.warn('Connection error:', err);
    });
  });

  // check for issues with hosting the game
  hostPeer.on('error', (err: Error & { type?: string }) => {
    const message = (err && (err.message || err.type)) || '';
    const isUnavailableId =
      err &&
      (err.type === 'unavailable-id' ||
        err.type === 'peer-unavailable' ||
        message.toLowerCase().includes('unavailable') ||
        message.toLowerCase().includes('taken'));

    if (isUnavailableId) {
      if (hostPeer) {
        hostPeer.destroy();
        if (hostFlushInterval !== undefined) clearInterval(hostFlushInterval);
      }
      console.log(`Mission ${peerId} is already live. Joining...`);

      joinPeerId(peerId, clientCallback);
      return;
    }

    console.warn(`Peer error: ${message || 'Unknown error'}`);
  });
}

function joinPeerId<HostMessageFormat, ClientMessageFormat>(
  peerId: string,
  callback: (event: ClientEvent<HostMessageFormat, ClientMessageFormat>) => void
): void {
  const clientPeer = new Peer();

  clientPeer.on('open', () => {
    console.log(`Connecting to ${peerId}...`);
    const conn = clientPeer.connect(peerId, { reliable: true });
    let clientBuffer: BufferedMessage<ClientMessageFormat>[] = [];
    let clientFlushInterval: number | undefined;

    function sendClientMessage(message: ClientMessageFormat, options?: SendOptions) {
      clientBuffer.push({ message, droppable: options?.droppable === true });
    }

    function flushClientMessages() {
      if (clientBuffer.length === 0) return;
      sendBatch(conn, clientBuffer);
      clientBuffer = [];
    }

    conn.on('open', () => {
      console.log(`Connected to ${peerId}`);
      // Only start flushing once the data channel is actually open — sending
      // any earlier throws "Connection is not open".
      clientFlushInterval = setInterval(flushClientMessages, NET_SEND_INTERVAL_MS);
      callback({
        type: 'start',
        sendMessage: sendClientMessage,
        id: clientPeer.id,
      });
    });

    conn.on('data', (data: HostMessageFormat[]) => {
      callback({
        type: 'message',
        id: peerId,
        message: data,
      });
    });

    conn.on('close', () => {
      console.log(`Connection to ${peerId} was lost.`);
      if (clientFlushInterval !== undefined) clearInterval(clientFlushInterval);
      clientBuffer = [];
      callback({
        type: 'disconnected',
        id: peerId,
      });
    });

    conn.on('error', (err: Error) => {
      console.error(`Connection error: ${err.message}`);
    });
  });
}
