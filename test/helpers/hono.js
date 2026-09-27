import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";

/**
 * Wraps a Hono app as a Node request listener, so supertest drives it over a
 * real socket exactly as the production server (@hono/node-server) does.
 * @param {Hono} app
 */
export function toListener(app) {
  return getRequestListener(app.fetch);
}

/**
 * Mounts a route module at `prefix` and returns a supertest-ready listener.
 * @param {string} prefix Mount path, e.g. "/users".
 * @param {Hono} routes The route module's Hono app.
 */
export function mountRoutes(prefix, routes) {
  const app = new Hono();
  app.route(prefix, routes);
  return toListener(app);
}
