# @synckit/react

## Interfaces

### CommentView

#### Extends

- [`Comment`](#comment)

#### Properties

##### anchor

```ts
anchor: JsonValue;
```

###### Inherited from

```ts
Comment.anchor
```

##### body

```ts
body: string;
```

###### Inherited from

```ts
Comment.body
```

##### createdAt

```ts
createdAt: string;
```

###### Inherited from

```ts
Comment.createdAt
```

##### endUserId

```ts
endUserId: string;
```

###### Inherited from

```ts
Comment.endUserId
```

##### id

```ts
id: string;
```

###### Inherited from

```ts
Comment.id
```

##### pending?

```ts
optional pending?: boolean;
```

True while an optimistic create is awaiting server confirmation.

##### resolvedAt

```ts
resolvedAt: string | null;
```

###### Inherited from

```ts
Comment.resolvedAt
```

##### threadId

```ts
threadId: string | null;
```

###### Inherited from

```ts
Comment.threadId
```

***

### UseCommentsResult

#### Properties

##### comments

```ts
comments: CommentView[];
```

##### create

```ts
create: (input) => Promise<void>;
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

`Promise`\<`void`\>

##### error

```ts
error: string | undefined;
```

##### isLoading

```ts
isLoading: boolean;
```

##### refresh

```ts
refresh: () => Promise<void>;
```

###### Returns

`Promise`\<`void`\>

##### resolve

```ts
resolve: (commentId, resolved?) => Promise<void>;
```

###### Parameters

###### commentId

`string`

###### resolved?

`boolean`

###### Returns

`Promise`\<`void`\>

***

### UseNotificationsResult

#### Properties

##### markAllRead

```ts
markAllRead: () => void;
```

###### Returns

`void`

##### markRead

```ts
markRead: (ids) => void;
```

Marks notifications read locally; wire persistence up via your backend.

###### Parameters

###### ids

`string`[]

###### Returns

`void`

##### notifications

```ts
notifications: object[];
```

###### createdAt

```ts
createdAt: string;
```

###### id

```ts
id: string;
```

###### payload

```ts
payload: JsonValue;
```

###### readAt

```ts
readAt: string | null;
```

###### type

```ts
type: string;
```

##### unreadCount

```ts
unreadCount: number;
```

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

### Status

```ts
type Status = "idle" | "connecting" | "connected" | "reconnecting" | "closed";
```

Connection lifecycle of the client.

## Functions

### CommentPin()

```ts
function CommentPin(__namedParameters): Element | null;
```

Floating pin attached to the element carrying
`data-synckit-anchor="<anchor>"`; clicking it opens the comment thread for
that anchor. Repositions on scroll and resize.

#### Parameters

##### \_\_namedParameters

###### anchor

`string`

#### Returns

`Element` \| `null`

***

### CommentsThread()

```ts
function CommentsThread(__namedParameters): Element;
```

Complete comment thread UI for a room (optionally scoped to an anchor):
composer, threaded replies, resolve/unresolve and optimistic sends.

#### Parameters

##### \_\_namedParameters

###### anchor?

[`JsonValue`](#jsonvalue)

#### Returns

`Element`

***

### LiveCursors()

```ts
function LiveCursors(): Element;
```

Renders every other member's cursor (from presence data `{cursor:{x,y}}`)
with the user's name. Positions are interpolated with requestAnimationFrame
— DOM transforms are written directly, so a moving cursor never re-renders
the React tree. Theme via --synckit-cursor-label-* variables.

#### Returns

`Element`

***

### NotificationInbox()

```ts
function NotificationInbox(): Element;
```

Bell button with unread badge and a dropdown inbox (Escape / outside-click
 to close, mark-all-read).

#### Returns

`Element`

***

### PresenceAvatars()

```ts
function PresenceAvatars(__namedParameters): Element;
```

Overlapping stack of everyone else in the room, capped at `max` + "+N".

#### Parameters

##### \_\_namedParameters

###### max?

`number` = `5`

#### Returns

`Element`

***

### RoomProvider()

```ts
function RoomProvider(__namedParameters): Element | null;
```

Joins a room for the lifetime of the subtree.

#### Parameters

##### \_\_namedParameters

###### children

`ReactNode`

###### id

`string`

###### initialPresence?

[`JsonValue`](#jsonvalue)

#### Returns

`Element` \| `null`

***

### SyncKitProvider()

```ts
function SyncKitProvider(__namedParameters): Element;
```

Provides the SyncKit client to the tree and manages its connection.

#### Parameters

##### \_\_namedParameters

###### children

`ReactNode`

###### client

`SyncKitClient`

#### Returns

`Element`

***

### useBroadcastEvent()

```ts
function useBroadcastEvent(): (event, payload) => void;
```

Returns a stable emitter for custom room events.

#### Returns

(`event`, `payload`) => `void`

***

### useClient()

```ts
function useClient(): SyncKitClient;
```

#### Returns

`SyncKitClient`

***

### useComments()

```ts
function useComments(options?): UseCommentsResult;
```

Live comment list of the room (optionally filtered by anchor) with
optimistic creates (rolled back on failure) and realtime updates.

#### Parameters

##### options?

###### anchor?

[`JsonValue`](#jsonvalue)

#### Returns

[`UseCommentsResult`](#usecommentsresult)

***

### useConnectionStatus()

```ts
function useConnectionStatus(): Status;
```

Connection status of the client, live.

#### Returns

[`Status`](#status)

***

### useEventListener()

```ts
function useEventListener(event, handler): void;
```

Subscribes to a custom room event for the component's lifetime.

#### Parameters

##### event

`string`

##### handler

(`payload`, `from`) => `void`

#### Returns

`void`

***

### useMyPresence()

```ts
function useMyPresence(): [JsonValue, (data) => void];
```

[myPresence, updateMyPresence] — like useState, synced to the room.

#### Returns

\[[`JsonValue`](#jsonvalue), (`data`) => `void`\]

***

### useNotifications()

```ts
function useNotifications(): UseNotificationsResult;
```

Realtime notification inbox state for the current user.

#### Returns

[`UseNotificationsResult`](#usenotificationsresult)

***

### useOthers()

```ts
function useOthers<T>(selector?, isEqual?): T;
```

Everyone else in the room. With a selector, components re-render only when
the selected value changes (compared with `isEqual`, default Object.is).

#### Type Parameters

##### T

`T` = `object`[]

#### Parameters

##### selector?

(`others`) => `T`

##### isEqual?

(`a`, `b`) => `boolean`

#### Returns

`T`

***

### useRoom()

```ts
function useRoom(): Room;
```

The Room handle for imperative access (escape hatch).

#### Returns

`Room`

***

### useUpdateMyPresence()

```ts
function useUpdateMyPresence(throttleMs?): (data) => void;
```

Presence updater throttled to one send per `throttleMs` (default 60 ms —
~16 updates/s, comfortably under the server's rate limit). Does not
subscribe to presence, so the component never re-renders because of it.

#### Parameters

##### throttleMs?

`number` = `60`

#### Returns

(`data`) => `void`
