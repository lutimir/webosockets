# @synckit/client

## Classes

### Emitter

Minimal typed event emitter — the only eventing primitive in the SDK.

#### Type Parameters

##### Events

`Events` *extends* `Record`\<`string`, `unknown`\>

#### Constructors

##### Constructor

```ts
new Emitter<Events>(): Emitter<Events>;
```

###### Returns

[`Emitter`](#emitter)\<`Events`\>

#### Methods

##### clear()

```ts
clear(): void;
```

###### Returns

`void`

##### emit()

```ts
emit<K>(event, payload): void;
```

###### Type Parameters

###### K

`K` *extends* `string` \| `number` \| `symbol`

###### Parameters

###### event

`K`

###### payload

`Events`\[`K`\]

###### Returns

`void`

##### on()

```ts
on<K>(event, handler): Unsubscribe;
```

###### Type Parameters

###### K

`K` *extends* `string` \| `number` \| `symbol`

###### Parameters

###### event

`K`

###### handler

(`payload`) => `void`

###### Returns

[`Unsubscribe`](#unsubscribe)

***

### Room

#### Constructors

##### Constructor

```ts
new Room(
   externalId, 
   initialPresence, 
   deps): Room;
```

###### Parameters

###### externalId

`string`

###### initialPresence

[`JsonValue`](#jsonvalue) \| `undefined`

###### deps

[`RoomDeps`](#roomdeps)

###### Returns

[`Room`](#room)

#### Properties

##### broadcast

```ts
readonly broadcast: object;
```

###### emit

```ts
emit: (event, payload) => void;
```

###### Parameters

###### event

`string`

###### payload

[`JsonValue`](#jsonvalue)

###### Returns

`void`

###### on

```ts
on: (event, handler) => Unsubscribe;
```

###### Parameters

###### event

`string`

###### handler

(`payload`, `from`) => `void`

###### Returns

[`Unsubscribe`](#unsubscribe)

##### comments

```ts
readonly comments: object;
```

###### create

```ts
create: (input) => Promise<{
  anchor: JsonValue;
  body: string;
  createdAt: string;
  endUserId: string;
  id: string;
  resolvedAt: string | null;
  threadId: string | null;
}>;
```

###### Parameters

###### input

###### anchor?

[`JsonValue`](#jsonvalue)

###### body

`string`

###### threadId?

`string`

###### Returns

`Promise`\<\{
  `anchor`: [`JsonValue`](#jsonvalue);
  `body`: `string`;
  `createdAt`: `string`;
  `endUserId`: `string`;
  `id`: `string`;
  `resolvedAt`: `string` \| `null`;
  `threadId`: `string` \| `null`;
\}\>

###### list

```ts
list: (options) => Promise<CommentPage>;
```

###### Parameters

###### options?

###### cursor?

`string`

###### limit?

`number`

###### Returns

`Promise`\<[`CommentPage`](#commentpage)\>

###### on

```ts
on: (event, handler) => Unsubscribe;
```

###### Parameters

###### event

`"updated"` \| `"created"`

###### handler

(`comment`) => `void`

###### Returns

[`Unsubscribe`](#unsubscribe)

###### resolve

```ts
resolve: (commentId, resolved) => Promise<{
  anchor: JsonValue;
  body: string;
  createdAt: string;
  endUserId: string;
  id: string;
  resolvedAt: string | null;
  threadId: string | null;
}>;
```

###### Parameters

###### commentId

`string`

###### resolved?

`boolean` = `true`

###### Returns

`Promise`\<\{
  `anchor`: [`JsonValue`](#jsonvalue);
  `body`: `string`;
  `createdAt`: `string`;
  `endUserId`: `string`;
  `id`: `string`;
  `resolvedAt`: `string` \| `null`;
  `threadId`: `string` \| `null`;
\}\>

##### externalId

```ts
readonly externalId: string;
```

##### presence

```ts
readonly presence: object;
```

###### get

```ts
get: () => object[];
```

Everyone else currently in the room (never includes yourself).

###### Returns

`object`[]

###### getMy

```ts
getMy: () => JsonValue;
```

###### Returns

[`JsonValue`](#jsonvalue)

###### subscribe

```ts
subscribe: (handler) => Unsubscribe;
```

Calls back immediately with the current snapshot, then on every change.

###### Parameters

###### handler

(`others`) => `void`

###### Returns

[`Unsubscribe`](#unsubscribe)

###### update

```ts
update: (data) => void;
```

###### Parameters

###### data

[`JsonValue`](#jsonvalue)

###### Returns

`void`

#### Methods

##### handleServerMessage()

```ts
handleServerMessage(message): void;
```

###### Parameters

###### message

  \| \{
  `presence`: `object`[];
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"room_joined"`;
\}
  \| \{
  `joined`: `object`[];
  `left`: `string`[];
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"presence_diff"`;
  `updated`: `object`[];
\}
  \| \{
  `event`: `string`;
  `from`: `string`;
  `payload`: [`JsonValue`](#jsonvalue);
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"broadcast_received"`;
\}
  \| \{
  `comment`: \{
     `anchor`: [`JsonValue`](#jsonvalue);
     `body`: `string`;
     `createdAt`: `string`;
     `endUserId`: `string`;
     `id`: `string`;
     `resolvedAt`: `string` \| `null`;
     `threadId`: `string` \| `null`;
  \};
  `requestId?`: `string`;
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"comment_created"`;
\}
  \| \{
  `comment`: \{
     `anchor`: [`JsonValue`](#jsonvalue);
     `body`: `string`;
     `createdAt`: `string`;
     `endUserId`: `string`;
     `id`: `string`;
     `resolvedAt`: `string` \| `null`;
     `threadId`: `string` \| `null`;
  \};
  `requestId?`: `string`;
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"comment_updated"`;
\}
  \| \{
  `items`: `object`[];
  `nextCursor?`: `string`;
  `requestId`: `string`;
  `roomExternalId`: `string`;
  `type`: `"comment_list_result"`;
\}
  \| \{
  `notification`: \{
     `createdAt`: `string`;
     `id`: `string`;
     `payload`: [`JsonValue`](#jsonvalue);
     `readAt`: `string` \| `null`;
     `type`: `string`;
  \};
  `type`: `"notification"`;
\}
  \| \{
  `code`:   \| `"invalid_message"`
     \| `"invalid_request"`
     \| `"not_found"`
     \| `"not_in_room"`
     \| `"room_limit_reached"`
     \| `"rate_limited"`
     \| `"slow_consumer"`
     \| `"internal_error"`;
  `message`: `string`;
  `requestId?`: `string`;
  `type`: `"error"`;
\}
  \| \{
  `ts`: `number`;
  `type`: `"pong"`;
\}

###### Returns

`void`

##### leave()

```ts
leave(): Promise<void>;
```

###### Returns

`Promise`\<`void`\>

##### onResync()

```ts
onResync(handler): Unsubscribe;
```

###### Parameters

###### handler

() => `void`

###### Returns

[`Unsubscribe`](#unsubscribe)

##### sendJoin()

```ts
sendJoin(): void;
```

Sent on join and again on every reconnect (with the latest presence).

###### Returns

`void`

***

### SyncKitClient

#### Constructors

##### Constructor

```ts
new SyncKitClient(options): SyncKitClient;
```

###### Parameters

###### options

[`SyncKitClientOptions`](#synckitclientoptions)

###### Returns

[`SyncKitClient`](#synckitclient)

#### Properties

##### notifications

```ts
readonly notifications: object;
```

###### subscribe

```ts
subscribe: (handler) => Unsubscribe;
```

###### Parameters

###### handler

(`notification`) => `void`

###### Returns

[`Unsubscribe`](#unsubscribe)

#### Accessors

##### endUserId

###### Get Signature

```ts
get endUserId(): string | undefined;
```

Everyone-else user id of this client, known once a token was fetched.

###### Returns

`string` \| `undefined`

##### status

###### Get Signature

```ts
get status(): Status;
```

###### Returns

[`Status`](#status-1)

#### Methods

##### connect()

```ts
connect(): void;
```

Starts (or restarts) the connection. Safe to call repeatedly.

###### Returns

`void`

##### disconnect()

```ts
disconnect(): void;
```

Closes the connection permanently — no reconnects until connect().

###### Returns

`void`

##### joinRoom()

```ts
joinRoom(roomExternalId, options?): Room;
```

Returns the room handle (creating it if needed) and joins it as soon as
the connection is up. Auto-connects an idle client.

###### Parameters

###### roomExternalId

`string`

###### options?

[`JoinRoomOptions`](#joinroomoptions) = `{}`

###### Returns

[`Room`](#room)

##### on()

###### Call Signature

```ts
on(event, handler): Unsubscribe;
```

###### Parameters

###### event

`"status"`

###### handler

(`status`) => `void`

###### Returns

[`Unsubscribe`](#unsubscribe)

###### Call Signature

```ts
on(event, handler): Unsubscribe;
```

###### Parameters

###### event

`"error"`

###### handler

(`error`) => `void`

###### Returns

[`Unsubscribe`](#unsubscribe)

## Interfaces

### BackoffOptions

#### Properties

##### maxDelayMs

```ts
maxDelayMs: number;
```

##### minDelayMs

```ts
minDelayMs: number;
```

***

### ClientError

#### Properties

##### code

```ts
code: string;
```

##### message

```ts
message: string;
```

***

### CommentPage

#### Properties

##### items

```ts
items: object[];
```

###### anchor

```ts
anchor: JsonValue;
```

###### body

```ts
body: string;
```

###### createdAt

```ts
createdAt: string;
```

###### endUserId

```ts
endUserId: string;
```

###### id

```ts
id: string;
```

###### resolvedAt

```ts
resolvedAt: string | null;
```

###### threadId

```ts
threadId: string | null;
```

##### nextCursor

```ts
nextCursor: string | undefined;
```

***

### JoinRoomOptions

#### Properties

##### initialPresence?

```ts
optional initialPresence?: JsonValue;
```

***

### RoomDeps

Callbacks the client injects into each room.

#### Properties

##### generateRequestId

```ts
generateRequestId: () => string;
```

###### Returns

`string`

##### getMyId

```ts
getMyId: () => string | undefined;
```

###### Returns

`string` \| `undefined`

##### onLeft

```ts
onLeft: (externalId) => void;
```

###### Parameters

###### externalId

`string`

###### Returns

`void`

##### request

```ts
request: (message) => Promise<
  | {
  presence: object[];
  roomExternalId: string;
  seq: number;
  type: "room_joined";
}
  | {
  joined: object[];
  left: string[];
  roomExternalId: string;
  seq: number;
  type: "presence_diff";
  updated: object[];
}
  | {
  event: string;
  from: string;
  payload: JsonValue;
  roomExternalId: string;
  seq: number;
  type: "broadcast_received";
}
  | {
  comment: {
     anchor: JsonValue;
     body: string;
     createdAt: string;
     endUserId: string;
     id: string;
     resolvedAt: string | null;
     threadId: string | null;
  };
  requestId?: string;
  roomExternalId: string;
  seq: number;
  type: "comment_created";
}
  | {
  comment: {
     anchor: JsonValue;
     body: string;
     createdAt: string;
     endUserId: string;
     id: string;
     resolvedAt: string | null;
     threadId: string | null;
  };
  requestId?: string;
  roomExternalId: string;
  seq: number;
  type: "comment_updated";
}
  | {
  items: object[];
  nextCursor?: string;
  requestId: string;
  roomExternalId: string;
  type: "comment_list_result";
}
  | {
  notification: {
     createdAt: string;
     id: string;
     payload: JsonValue;
     readAt: string | null;
     type: string;
  };
  type: "notification";
}
  | {
  code:   | "invalid_message"
     | "invalid_request"
     | "not_found"
     | "not_in_room"
     | "room_limit_reached"
     | "rate_limited"
     | "slow_consumer"
     | "internal_error";
  message: string;
  requestId?: string;
  type: "error";
}
  | {
  ts: number;
  type: "pong";
}>;
```

###### Parameters

###### message

  \| \{
  `initialPresence?`: JsonValue \| undefined;
  `roomExternalId`: `string`;
  `type`: `"join_room"`;
\}
  \| \{
  `roomExternalId`: `string`;
  `type`: `"leave_room"`;
\}
  \| \{
  `data`: [`JsonValue`](#jsonvalue);
  `roomExternalId`: `string`;
  `type`: `"presence_update"`;
\}
  \| \{
  `event`: `string`;
  `payload`: [`JsonValue`](#jsonvalue);
  `roomExternalId`: `string`;
  `type`: `"broadcast"`;
\}
  \| \{
  `anchor?`: JsonValue \| undefined;
  `body`: `string`;
  `requestId?`: `string`;
  `roomExternalId`: `string`;
  `threadId?`: `string`;
  `type`: `"comment_create"`;
\}
  \| \{
  `cursor?`: `string`;
  `limit?`: `number`;
  `requestId`: `string`;
  `roomExternalId`: `string`;
  `type`: `"comment_list"`;
\}
  \| \{
  `commentId`: `string`;
  `requestId?`: `string`;
  `resolved`: `boolean`;
  `roomExternalId`: `string`;
  `type`: `"comment_resolve"`;
\}
  \| \{
  `type`: `"ping"`;
\} & `object`

###### Returns

`Promise`\<
  \| \{
  `presence`: `object`[];
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"room_joined"`;
\}
  \| \{
  `joined`: `object`[];
  `left`: `string`[];
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"presence_diff"`;
  `updated`: `object`[];
\}
  \| \{
  `event`: `string`;
  `from`: `string`;
  `payload`: [`JsonValue`](#jsonvalue);
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"broadcast_received"`;
\}
  \| \{
  `comment`: \{
     `anchor`: [`JsonValue`](#jsonvalue);
     `body`: `string`;
     `createdAt`: `string`;
     `endUserId`: `string`;
     `id`: `string`;
     `resolvedAt`: `string` \| `null`;
     `threadId`: `string` \| `null`;
  \};
  `requestId?`: `string`;
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"comment_created"`;
\}
  \| \{
  `comment`: \{
     `anchor`: [`JsonValue`](#jsonvalue);
     `body`: `string`;
     `createdAt`: `string`;
     `endUserId`: `string`;
     `id`: `string`;
     `resolvedAt`: `string` \| `null`;
     `threadId`: `string` \| `null`;
  \};
  `requestId?`: `string`;
  `roomExternalId`: `string`;
  `seq`: `number`;
  `type`: `"comment_updated"`;
\}
  \| \{
  `items`: `object`[];
  `nextCursor?`: `string`;
  `requestId`: `string`;
  `roomExternalId`: `string`;
  `type`: `"comment_list_result"`;
\}
  \| \{
  `notification`: \{
     `createdAt`: `string`;
     `id`: `string`;
     `payload`: [`JsonValue`](#jsonvalue);
     `readAt`: `string` \| `null`;
     `type`: `string`;
  \};
  `type`: `"notification"`;
\}
  \| \{
  `code`:   \| `"invalid_message"`
     \| `"invalid_request"`
     \| `"not_found"`
     \| `"not_in_room"`
     \| `"room_limit_reached"`
     \| `"rate_limited"`
     \| `"slow_consumer"`
     \| `"internal_error"`;
  `message`: `string`;
  `requestId?`: `string`;
  `type`: `"error"`;
\}
  \| \{
  `ts`: `number`;
  `type`: `"pong"`;
\}\>

##### send

```ts
send: (message, bufferable) => void;
```

###### Parameters

###### message

  \| \{
  `initialPresence?`: [`JsonValue`](#jsonvalue);
  `roomExternalId`: `string`;
  `type`: `"join_room"`;
\}
  \| \{
  `roomExternalId`: `string`;
  `type`: `"leave_room"`;
\}
  \| \{
  `data`: [`JsonValue`](#jsonvalue);
  `roomExternalId`: `string`;
  `type`: `"presence_update"`;
\}
  \| \{
  `event`: `string`;
  `payload`: [`JsonValue`](#jsonvalue);
  `roomExternalId`: `string`;
  `type`: `"broadcast"`;
\}
  \| \{
  `anchor?`: [`JsonValue`](#jsonvalue);
  `body`: `string`;
  `requestId?`: `string`;
  `roomExternalId`: `string`;
  `threadId?`: `string`;
  `type`: `"comment_create"`;
\}
  \| \{
  `cursor?`: `string`;
  `limit?`: `number`;
  `requestId`: `string`;
  `roomExternalId`: `string`;
  `type`: `"comment_list"`;
\}
  \| \{
  `commentId`: `string`;
  `requestId?`: `string`;
  `resolved`: `boolean`;
  `roomExternalId`: `string`;
  `type`: `"comment_resolve"`;
\}
  \| \{
  `type`: `"ping"`;
\}

###### bufferable

`boolean`

###### Returns

`void`

***

### SyncKitClientOptions

#### Properties

##### offlineBufferSize?

```ts
optional offlineBufferSize?: number;
```

Broadcast/presence messages buffered while offline (default 100).

##### reconnectMaxDelayMs?

```ts
optional reconnectMaxDelayMs?: number;
```

Reconnect backoff ceiling (default 30000 ms).

##### reconnectMinDelayMs?

```ts
optional reconnectMinDelayMs?: number;
```

Reconnect backoff floor (default 1000 ms).

##### requestTimeoutMs?

```ts
optional requestTimeoutMs?: number;
```

Correlated request timeout for comment operations (default 10000 ms).

##### tokenProvider

```ts
tokenProvider: () => string | Promise<string>;
```

Returns a client JWT minted by your backend via POST /v1/tokens. Called
on every (re)connect, so expired tokens refresh automatically.

###### Returns

`string` \| `Promise`\<`string`\>

##### url

```ts
url: string;
```

Realtime endpoint, e.g. "wss://api.example.com/v1/realtime".

##### WebSocketImpl?

```ts
optional WebSocketImpl?: WebSocketConstructor;
```

Override the WebSocket implementation (tests, exotic runtimes).

***

### WebSocketLike

Browser-and-Node compatible subset of the WebSocket interface.

#### Properties

##### readyState

```ts
readyState: number;
```

#### Methods

##### addEventListener()

###### Call Signature

```ts
addEventListener(type, listener): void;
```

###### Parameters

###### type

`"open"`

###### listener

() => `void`

###### Returns

`void`

###### Call Signature

```ts
addEventListener(type, listener): void;
```

###### Parameters

###### type

`"message"`

###### listener

(`event`) => `void`

###### Returns

`void`

###### Call Signature

```ts
addEventListener(type, listener): void;
```

###### Parameters

###### type

`"close"`

###### listener

(`event`) => `void`

###### Returns

`void`

###### Call Signature

```ts
addEventListener(type, listener): void;
```

###### Parameters

###### type

`"error"`

###### listener

() => `void`

###### Returns

`void`

##### close()

```ts
close(code?, reason?): void;
```

###### Parameters

###### code?

`number`

###### reason?

`string`

###### Returns

`void`

##### send()

```ts
send(data): void;
```

###### Parameters

###### data

`string`

###### Returns

`void`

## Type Aliases

### Comment

```ts
type Comment = z.infer<typeof commentSchema>;
```

***

### JsonValue

```ts
type JsonValue = 
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
[key: string]: JsonValue;
};
```

***

### Notification

```ts
type Notification = z.infer<typeof notificationSchema>;
```

***

### PresenceEntry

```ts
type PresenceEntry = z.infer<typeof presenceEntrySchema>;
```

***

### ServerMessage

```ts
type ServerMessage = z.infer<typeof serverMessageSchema>;
```

***

### Status

```ts
type Status = "idle" | "connecting" | "connected" | "reconnecting" | "closed";
```

Connection lifecycle of the client.

***

### Unsubscribe

```ts
type Unsubscribe = () => void;
```

#### Returns

`void`

***

### WebSocketConstructor

```ts
type WebSocketConstructor = (url) => WebSocketLike;
```

#### Parameters

##### url

`string`

#### Returns

[`WebSocketLike`](#websocketlike)

## Functions

### computeBackoffDelay()

```ts
function computeBackoffDelay(
   attempt, 
   options, 
   random?): number;
```

Exponential backoff with full jitter: delay grows min * 2^attempt capped at
max, then jittered into [delay/2, delay] so reconnect storms spread out.

#### Parameters

##### attempt

`number`

##### options

[`BackoffOptions`](#backoffoptions)

##### random?

() => `number`

#### Returns

`number`

***

### createClient()

```ts
function createClient(options): SyncKitClient;
```

#### Parameters

##### options

[`SyncKitClientOptions`](#synckitclientoptions)

#### Returns

[`SyncKitClient`](#synckitclient)
