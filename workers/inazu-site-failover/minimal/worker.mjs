import { DurableObject } from "cloudflare:workers";

const LAP_MS = 1500;
const NETWORK_TOLERANCE_MS = 300;

export default {
    fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname !== "/api/rotations") return env.ASSETS.fetch(request);
        if (request.method !== "GET") {
            return new Response(null, { status: 405, headers: { Allow: "GET" } });
        }
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response(null, { status: 426, headers: { Upgrade: "websocket" } });
        }
        if (request.headers.get("Origin") !== url.origin) return new Response(null, { status: 403 });

        return env.ROTATIONS.getByName("logo").fetch(request);
    },
};

export class RotationCounter extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.total = ctx.storage.kv.get("total") ?? 0;
    }

    fetch() {
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment(Date.now() + LAP_MS);
        server.send(JSON.stringify({ type: "total", total: this.total }));
        return new Response(null, { status: 101, webSocket: client });
    }

    webSocketMessage(socket, message) {
        if (message !== "lap") {
            socket.close(1008, "Expected lap");
            return;
        }
        // Allow some network jitter while keeping the sustained rate to one lap per cycle.
        const now = Date.now();
        const nextLapAt = socket.deserializeAttachment();
        if (now < nextLapAt - NETWORK_TOLERANCE_MS) return;
        socket.serializeAttachment(Math.max(now, nextLapAt) + LAP_MS);

        const total = this.total + 1;
        this.ctx.storage.kv.put("total", total);
        this.total = total;

        const update = JSON.stringify({ type: "total", total, own: false });
        const ownUpdate = JSON.stringify({ type: "total", total, own: true });
        for (const peer of this.ctx.getWebSockets()) {
            if (peer.readyState !== WebSocket.OPEN) continue;
            try {
                peer.send(peer === socket ? ownUpdate : update);
            } catch {
                // A disconnect during delivery should not interrupt the remaining sends.
            }
        }
    }

    webSocketClose(socket, code, reason) {
        if (code === 1006 || socket.readyState === WebSocket.CLOSED) return;
        socket.close(code === 1005 ? 1000 : code, reason);
    }
}
