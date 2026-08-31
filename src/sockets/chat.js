import { Server } from "socket.io";
import { verifyToken } from "../utils/token.js";
import { detectEmotion } from "../utils/emotion.js";
import pool from "../config/db.js";

export function initSocket(httpServer, corsOrigins) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
  });

  // Tracks every active socket connection per user id, since a user can have
  // multiple tabs/devices open. Used to relay call signaling to all of a
  // target user's connections.
  const userSockets = new Map(); // userId -> Set<socketId>

  function addUserSocket(userId, socketId) {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(socketId);
  }

  function removeUserSocket(userId, socketId) {
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) userSockets.delete(userId);
  }

  function emitToUser(io, userId, event, payload) {
    const set = userSockets.get(userId);
    if (!set || set.size === 0) return false;
    for (const socketId of set) {
      io.to(socketId).emit(event, payload);
    }
    return true;
  }

  // Fetches a lightweight preview of the message being replied to, so the
  // client can render "replying to: ..." without a separate round trip.
  // Returns null if replyToId is falsy or the message no longer exists.
  async function getReplyPreview(replyToId, roomId) {
    if (!replyToId) return null;
    const result = await pool.query(
      `SELECT m.id, m.content, m.message_type, m.file_name, u.username
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1 AND m.room_id = $2`,
      [replyToId, roomId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      senderUsername: row.username,
      messageType: row.message_type,
      preview: row.message_type === "text" ? row.content : row.file_name || "Attachment",
    };
  }

  // Authenticate every socket connection using the JWT the client sends
  // in the handshake, e.g. io(URL, { auth: { token: "Bearer <token>" } })
  io.use((socket, next) => {
    const raw = socket.handshake.auth?.token;
    if (!raw) return next(new Error("No auth token provided"));

    const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
    try {
      const payload = verifyToken(token);
      socket.user = payload; // { id, username }
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.user.username} (${socket.id})`);
    addUserSocket(socket.user.id, socket.id);

    // Client asks to join a room it's already a member of (DB-checked)
    socket.on("join_room", async ({ roomId }, ack) => {
      try {
        const membership = await pool.query(
          "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
          [roomId, socket.user.id]
        );
        if (membership.rows.length === 0) {
          return ack?.({ ok: false, error: "not a member of this room" });
        }

        socket.join(`room:${roomId}`);
        ack?.({ ok: true });
      } catch (err) {
        console.error("join_room error:", err);
        ack?.({ ok: false, error: "internal server error" });
      }
    });

    socket.on("leave_room", ({ roomId }) => {
      socket.leave(`room:${roomId}`);
    });

    // Client sends a message; server tags emotion, persists it, broadcasts it
    socket.on("send_message", async ({ roomId, content, replyToId }, ack) => {
      if (!roomId || !content || typeof content !== "string" || !content.trim()) {
        return ack?.({ ok: false, error: "roomId and non-empty content are required" });
      }
      if (content.length > 2000) {
        return ack?.({ ok: false, error: "message too long" });
      }

      try {
        const membership = await pool.query(
          "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
          [roomId, socket.user.id]
        );
        if (membership.rows.length === 0) {
          return ack?.({ ok: false, error: "not a member of this room" });
        }

        const { tag } = detectEmotion(content);
        const replyPreview = await getReplyPreview(replyToId, roomId);

        const result = await pool.query(
          `INSERT INTO messages (room_id, sender_id, content, emotion_tag, reply_to_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, content, emotion_tag, created_at`,
          [roomId, socket.user.id, content, tag, replyPreview?.id || null]
        );
        const saved = result.rows[0];

        const payload = {
          id: saved.id,
          roomId,
          content: saved.content,
          emotionTag: saved.emotion_tag,
          messageType: "text",
          createdAt: saved.created_at,
          sender: { id: socket.user.id, username: socket.user.username },
          replyTo: replyPreview,
        };

        io.to(`room:${roomId}`).emit("new_message", payload);
        ack?.({ ok: true, message: payload });
      } catch (err) {
        console.error("send_message error:", err);
        ack?.({ ok: false, error: "internal server error" });
      }
    });

    // Client already uploaded a file via POST /upload/:roomId and now
    // shares it as a message. No emotion detection on file messages.
    // Also used for voice messages — the client just uploads the recorded
    // audio blob like any other file; message_type stays 'file' and the
    // frontend tells images/audio/other apart via file_mime.
    socket.on("send_file_message", async ({ roomId, url, fileName, fileMime, fileSize, replyToId }, ack) => {
      if (!roomId || !url || !fileName) {
        return ack?.({ ok: false, error: "roomId, url, and fileName are required" });
      }

      try {
        const membership = await pool.query(
          "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
          [roomId, socket.user.id]
        );
        if (membership.rows.length === 0) {
          return ack?.({ ok: false, error: "not a member of this room" });
        }

        const replyPreview = await getReplyPreview(replyToId, roomId);

        const result = await pool.query(
          `INSERT INTO messages (room_id, sender_id, content, emotion_tag, message_type, file_url, file_name, file_mime, file_size, reply_to_id)
           VALUES ($1, $2, $3, 'neutral', 'file', $4, $5, $6, $7, $8)
           RETURNING id, content, emotion_tag, message_type, file_url, file_name, file_mime, file_size, created_at`,
          [roomId, socket.user.id, fileName, url, fileName, fileMime || null, fileSize || null, replyPreview?.id || null]
        );
        const saved = result.rows[0];

        const payload = {
          id: saved.id,
          roomId,
          content: saved.content,
          emotionTag: saved.emotion_tag,
          messageType: saved.message_type,
          fileUrl: saved.file_url,
          fileName: saved.file_name,
          fileMime: saved.file_mime,
          fileSize: saved.file_size,
          createdAt: saved.created_at,
          sender: { id: socket.user.id, username: socket.user.username },
          replyTo: replyPreview,
        };

        io.to(`room:${roomId}`).emit("new_message", payload);
        ack?.({ ok: true, message: payload });
      } catch (err) {
        console.error("send_file_message error:", err);
        ack?.({ ok: false, error: "internal server error" });
      }
    });

    // Lightweight "user is typing" signal, no DB write, no emotion tagging
    socket.on("typing", ({ roomId }) => {
      socket.to(`room:${roomId}`).emit("typing", {
        roomId,
        username: socket.user.username,
      });
    });

    // ---------- Call signaling (WebRTC) ----------
    // This server only relays signaling messages between two users' sockets.
    // It never sees or touches actual audio/video — that travels
    // peer-to-peer once the connection is established.

    // Caller starts a call: check the target is online, then ring them.
    socket.on("call:invite", async ({ targetUserId, roomId, callType }, ack) => {
      try {
        const membership = await pool.query(
          "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
          [roomId, targetUserId]
        );
        if (membership.rows.length === 0) {
          return ack?.({ ok: false, error: "target user is not in this room" });
        }

        const delivered = emitToUser(io, targetUserId, "call:incoming", {
          fromUser: { id: socket.user.id, username: socket.user.username },
          roomId,
          callType,
        });

        if (!delivered) {
          return ack?.({ ok: false, error: "user is offline" });
        }
        ack?.({ ok: true });
      } catch (err) {
        console.error("call:invite error:", err);
        ack?.({ ok: false, error: "internal server error" });
      }
    });

    // Callee accepted — tell the caller so they can create the offer.
    socket.on("call:accept", ({ targetUserId, roomId }) => {
      emitToUser(io, targetUserId, "call:accepted", {
        fromUser: { id: socket.user.id, username: socket.user.username },
        roomId,
      });
    });

    // Callee declined.
    socket.on("call:reject", ({ targetUserId }) => {
      emitToUser(io, targetUserId, "call:rejected", {
        fromUser: { id: socket.user.id, username: socket.user.username },
      });
    });

    // Generic relay for SDP offers/answers and ICE candidates.
    // data: { type: "offer" | "answer" | "candidate", payload: ... }
    socket.on("call:signal", ({ targetUserId, data }) => {
      emitToUser(io, targetUserId, "call:signal", {
        fromUserId: socket.user.id,
        data,
      });
    });

    // Either side can hang up.
    socket.on("call:end", ({ targetUserId }) => {
      emitToUser(io, targetUserId, "call:ended", {
        fromUserId: socket.user.id,
      });
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.user.username} (${socket.id})`);
      removeUserSocket(socket.user.id, socket.id);
    });
  });

  return io;
}
