export type Route =
  | { name: "menu" }
  | { name: "play"; gameId: string }
  | { name: "scores"; gameId: string };

type RouteHandler = (route: Route) => void;

const handlers: RouteHandler[] = [];

function parse(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "play" && parts[1]) return { name: "play", gameId: parts[1] };
  if (parts[0] === "scores" && parts[1]) return { name: "scores", gameId: parts[1] };
  return { name: "menu" };
}

function emit(): void {
  const route = parse(window.location.hash);
  handlers.forEach((h) => h(route));
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function onRoute(handler: RouteHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

export function start(): void {
  window.addEventListener("hashchange", emit);
  emit(); // handle initial hash
}

export function currentRoute(): Route {
  return parse(window.location.hash);
}
