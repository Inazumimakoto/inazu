import assert from "node:assert/strict";
import { on, once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createTestHarness } from "wrangler";

const endpoint = "https://inazu.me/api/rotations";
const handshake = { Upgrade: "websocket", Origin: "https://inazu.me" };

async function connect(server, t) {
    const response = await server.fetch(endpoint, { headers: handshake });
    assert.equal(response.status, 101);
    const socket = response.webSocket;
    const messages = on(socket, "message", { signal: t.signal });
    socket.accept();
    return {
        socket,
        async next() {
            const { value: [event] } = await messages.next();
            return JSON.parse(event.data);
        },
    };
}

test("rotations stay shared across sockets and hibernation", { timeout: 15000 }, async (t) => {
    const configPath = new URL("../../wrangler.minimal.jsonc", import.meta.url);
    const server = createTestHarness({ workers: [{ configPath }] });
    await server.listen();
    t.after(() => server.close());

    assert.equal((await server.fetch(endpoint)).status, 426);
    assert.equal((await server.fetch(endpoint, { method: "POST" })).status, 405);
    const foreign = { ...handshake, Origin: "https://example.org" };
    assert.equal((await server.fetch(endpoint, { headers: foreign })).status, 403);

    const a = await connect(server, t);
    const b = await connect(server, t);
    const initial = { type: "total", total: 0 };
    assert.deepEqual(await a.next(), initial);
    assert.deepEqual(await b.next(), initial);

    a.socket.send("lap"); // No full lap since the socket opened.
    await delay(1500);
    a.socket.send("lap");
    a.socket.send("lap"); // The second lap is too early.
    b.socket.send("lap");
    const seenByA = [await a.next(), await a.next()];
    const seenByB = [await b.next(), await b.next()];
    for (const messages of [seenByA, seenByB]) {
        assert.deepEqual(messages.map((m) => m.total), [1, 2]);
        assert.equal(messages.filter((m) => m.own).length, 1);
    }
    assert.notEqual(seenByA[0].own, seenByB[0].own);

    const closed = once(a.socket, "close", { signal: t.signal });
    a.socket.send("unknown");
    assert.equal((await closed)[0].code, 1008);
    await server.getWorker().evictDurableObject("ROTATIONS", { name: "logo", webSockets: "hibernate" });

    const c = await connect(server, t);
    assert.deepEqual(await c.next(), { type: "total", total: 2 });
    await delay(1500);
    c.socket.send("lap");
    assert.deepEqual(await c.next(), { type: "total", total: 3, own: true });
    assert.deepEqual(await b.next(), { type: "total", total: 3, own: false });
    b.socket.close(1000);
    c.socket.close(1000);
});
