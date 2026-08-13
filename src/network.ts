import Peer, { DataConnection } from 'peerjs';

type ClientConnections = DataConnection[];

interface StartEvent<MessageFormat> {
  type: 'start';
  sendMessage: (msg: MessageFormat) => void;
}

interface MessageEvent<MessageFormat> {
  type: 'message';
  id: string;
  message: MessageFormat;
}

interface DisconnectedEvent {
  type: 'disconnected';
  id: string;
}

type HostEvent<HostMessageFormat, ClientMessageFormat> =
  StartEvent<HostMessageFormat> | MessageEvent<ClientMessageFormat> | DisconnectedEvent;

type ClientEvent<HostMessageFormat, ClientMessageFormat> =
  StartEvent<ClientMessageFormat> | MessageEvent<HostMessageFormat> | DisconnectedEvent;

export function createOrJoinPeerId<HostMessageFormat, ClientMessageFormat>(
  peerId: string,
  hostCallback: (event: HostEvent<HostMessageFormat, ClientMessageFormat>) => void,
  clientCallback: (event: ClientEvent<HostMessageFormat, ClientMessageFormat>) => void
): void {
  const hostPeer = new Peer(peerId);

  const connections: ClientConnections = [];

  function sendHostMessage(message: HostMessageFormat) {
    for (const connection of connections) {
      connection.send(message);
    }
  }

  hostPeer.on('open', () => {
    console.log(`Hosting with peer ID: ${peerId}`);
    hostCallback({ type: 'start', sendMessage: sendHostMessage });
  });

  hostPeer.on('connection', (conn: DataConnection) => {
    connections.push(conn);
    conn.on('open', () => {
      console.log('Client connected:', conn.peer);
    });
    conn.on('data', (data: ClientMessageFormat) => {
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

    function sendClientMessage(message: ClientMessageFormat) {
      conn.send(message);
    }

    conn.on('open', () => {
      console.log(`Connected to ${peerId}`);
      callback({
        type: 'start',
        sendMessage: sendClientMessage,
      });
    });

    conn.on('data', (data: HostMessageFormat) => {
      console.log(`Received data from ${peerId}:`, data);
      callback({
        type: 'message',
        id: peerId,
        message: data,
      });
    });

    conn.on('close', () => {
      console.log(`Connection to ${peerId} was lost.`);
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
