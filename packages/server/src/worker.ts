export { GameRoom } from "./room";

interface Env {
  ROOM: DurableObjectNamespace;
}

/** Multiplayer transport only. AI runs entirely inside the browser Worker. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/room\/([^/]+)$/);

    if (!match) return new Response("Not Found", { status: 404 });

    const roomId = match[1];
    const objectId = env.ROOM.idFromName(roomId);
    return env.ROOM.get(objectId).fetch(request);
  },
};
