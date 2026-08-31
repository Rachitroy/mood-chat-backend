# Mood Chat — Backend

Server-side backend for a group chat app: username/password auth, real-time
messaging over Socket.io, and a rule-based emotion tagger that labels each
message (flirty, angry, sad, happy, neutral) so the frontend can trigger a
matching animation.

## Setup

1. **Install PostgreSQL** locally (or use a hosted instance) and create a database:
   ```bash
   createdb moodchat
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # edit .env: set DATABASE_URL, JWT_SECRET, CLIENT_ORIGIN
   ```

4. **Create tables**
   ```bash
   npm run db:setup
   ```

5. **Run the server**
   ```bash
   npm run dev
   ```
   Server starts on `http://localhost:4000` (or your configured `PORT`).

## REST API

| Method | Route                  | Auth | Body / Query                                  |
|--------|-------------------------|------|------------------------------------------------|
| POST   | `/auth/register`        | no   | `{ username, password }`                       |
| POST   | `/auth/login`            | no   | `{ username, password }`                       |
| POST   | `/rooms`                | yes  | `{ name, isGroup, memberUsernames: [] }`        |
| POST   | `/rooms/:id/join`       | yes  | —                                                |
| GET    | `/rooms`                | yes  | —                                                |
| GET    | `/rooms/:id/messages`   | yes  | `?limit=50`                                     |
| GET    | `/rooms/:id/members`   | yes  | —                                                |
| POST   | `/upload/:roomId`      | yes  | multipart/form-data, field name `file`          |

Authenticated routes expect `Authorization: Bearer <token>`, where `token`
comes from the register/login response.

## File & photo sharing

1. Client uploads the file via `POST /upload/:roomId` (multipart form data).
   The server validates room membership, saves the file under `/uploads`
   with a randomized filename (originals are never overwritten or exposed
   by name), and returns its public URL + metadata.
2. Client then sends a `send_file_message` socket event with that metadata,
   which persists a `message_type: 'file'` row and broadcasts it like any
   other message.
3. Files are served statically from `/uploads/<filename>` — no auth check
   on the static route itself, so treat the URL as effectively public
   (anyone with the link can view it, same as most chat apps' CDN links).

Max upload size is 15MB, enforced by `multer` in `routes/upload.js`.

## Real-time (Socket.io)

Connect with the JWT from login:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:4000", {
  auth: { token: `Bearer ${token}` },
});

socket.emit("join_room", { roomId: 1 }, (res) => console.log(res));

socket.emit(
  "send_message",
  { roomId: 1, content: "hey cutie 😉" },
  (res) => console.log(res) // { ok: true, message: { emotionTag: "flirty", ... } }
);

socket.on("new_message", (msg) => {
  // msg.emotionTag drives the frontend animation
  console.log(msg);
});

socket.on("typing", ({ username }) => console.log(`${username} is typing...`));
```

## Emotion tagging

`src/utils/emotion.js` is a standalone, dependency-free rule-based classifier
(keyword + emoji matching). It's called once, from `sockets/chat.js`, right
before a message is saved. To swap in something smarter later (a small ML
model, or an LLM call), you only need to change `detectEmotion()` — nothing
else in the app needs to know how the tag was produced.

## Project structure

```
src/
  config/
    db.js          Postgres connection pool
    schema.sql      Table definitions
    setupDb.js       Applies schema.sql
  middleware/
    auth.js          JWT-protects REST routes
  routes/
    auth.js          register / login
    rooms.js         create / join / list rooms, message history
  sockets/
    chat.js          Socket.io: auth, join/leave, send_message, typing
  utils/
    emotion.js       Rule-based emotion detector
    token.js         JWT sign/verify
  index.js           App entry point
```

## Next steps

- Frontend: connect via `socket.io-client`, render `emotionTag` as a UI
  animation (confetti for flirty, screen shake for angry, etc.)
- Swap `detectEmotion()` for an ML/LLM-based version once you want more
  nuance than keyword matching gives you
- Add rate limiting on `/auth` routes and on `send_message` to prevent spam
